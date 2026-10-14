"""Split the existing private SQL into independently committed, ordered web-editor batches."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'deliverables' / 'sql-por-partes'
LIMIT = 450_000
SOURCE = (ROOT / 'deliverables/supabase-roboticlab.sql').read_text(encoding='utf-8')
PACKAGE = hashlib.sha256(SOURCE.encode()).hexdigest()


def statements(source):
    """Only split outside SQL strings, quoted identifiers, comments and dollar bodies."""
    i = start = 0
    while i < len(source):
        if source.startswith('--', i):
            end = source.find('\n', i)
            i = len(source) if end == -1 else end + 1
        elif source.startswith('/*', i):
            depth = 1
            i += 2
            while depth:
                if source.startswith('/*', i):
                    depth += 1
                    i += 2
                elif source.startswith('*/', i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
                if i > len(source):
                    raise ValueError('Unterminated SQL comment')
        elif source[i] in "'\"":
            quote = source[i]
            i += 1
            while i < len(source):
                if source[i] == quote:
                    i += 1
                    if i < len(source) and source[i] == quote:
                        i += 1
                    else:
                        break
                else:
                    i += 1
            else:
                raise ValueError('Unterminated SQL string')
        elif source[i] == '$' and (match := re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$', source[i:])):
            tag = match.group()
            end = source.find(tag, i + len(tag))
            if end == -1:
                raise ValueError('Unterminated dollar body')
            i = end + len(tag)
        elif source[i] == ';':
            yield source[start:i + 1].strip()
            i += 1
            start = i
        else:
            i += 1
    assert not source[start:].strip(), 'Unexpected SQL after last statement'


SETUP = """
create table if not exists public.rl_import_chunks (
 package text not null, document_id uuid not null, position integer not null, content text not null,
 primary key(package,document_id,position)
);
create table if not exists public.rl_import_steps (
 package text not null, step integer not null, completed_at timestamptz not null default now(),
 primary key(package,step)
);
alter table public.rl_import_chunks enable row level security;
alter table public.rl_import_steps enable row level security;
revoke all on public.rl_import_chunks,public.rl_import_steps from public,anon,authenticated;
"""


def split_document(statement):
    literal = r"'(?:[^']|'')*'"
    match = re.fullmatch(
        r"insert into public\.rl_documents\((?P<columns>[^)]+)\) values\("
        rf"(?P<prefix>{literal},{literal},{literal},{literal},)'(?P<content>[A-Za-z0-9+/=]+)'"
        rf"(?P<suffix>,{literal})\) on conflict do nothing;", statement)
    if not match:
        raise ValueError('Oversized statement is not a recognized document insert')
    values = match.groupdict()
    document_id = values['prefix'].split(',')[0]
    expected_hash = re.findall(literal, values['prefix'])[-1]
    for position, start in enumerate(range(0, len(values['content']), 160_000)):
        content = values['content'][start:start + 160_000]
        yield ("insert into public.rl_import_chunks(package,document_id,position,content) values"
               f"('{PACKAGE}',{document_id},{position},'{content}') on conflict do nothing;")
    where = f"package='{PACKAGE}' and document_id={document_id}"
    assembled = f"(select string_agg(content,'' order by position) from public.rl_import_chunks where {where})"
    yield f"""do $rl_check$ begin
if not exists(select 1 from public.rl_documents where id={document_id}) and
 encode(sha256(decode(coalesce({assembled},''),'base64')),'hex') is distinct from {expected_hash}
then raise exception 'Documento incompleto. Ejecuta las partes anteriores en orden.'; end if;
end $rl_check$;"""
    yield (f"insert into public.rl_documents({values['columns']}) select "
           f"{values['prefix']}{assembled}{values['suffix']} "
           f"where not exists(select 1 from public.rl_documents where id={document_id}) on conflict do nothing;")
    yield f"delete from public.rl_import_chunks where {where};"


original = list(statements(SOURCE))
assert original[0].lower() == 'begin;' and original[-1].lower() == 'commit;'
expanded = []
for statement in original[1:-1]:
    if len(statement.encode()) > 200_000 and statement.startswith('insert into public.rl_documents('):
        expanded.extend(split_document(statement))
    else:
        expanded.append(statement)
assert max(len(s.encode()) for s in expanded) < LIMIT - 10_000
batches = []
batch = []
size = len(SETUP.encode())
for statement in expanded:
    length = len(statement.encode()) + 1
    if size + length > LIMIT - 10_000:
        batches.append(batch)
        batch, size = [], 0
    batch.append(statement)
    size += length
if batch:
    batches.append(batch)

# Verify the exact source IDs survived, including when the target already has newer records.
expected = {}
for statement in original:
    match = re.match(r"insert into public\.(rl_\w+)\(id,[^)]*\) values\('([0-9a-f-]{36})'", statement)
    if match:
        expected.setdefault(match[1], []).append(match[2])
checks = []
for table, ids in expected.items():
    sql_ids = ','.join(f"'{id}'::uuid" for id in ids)
    checks.append(f"if (select count(*) from public.{table} where id=any(array[{sql_ids}])) <> {len(ids)} then raise exception 'Faltan datos de {table}'; end if;")
checks.append("if exists(select 1 from public.rl_documents where encode(sha256(decode(content_base64,'base64')),'hex') is distinct from sha256) then raise exception 'Un documento no coincide con su huella SHA256'; end if;")
batches.append(['do $rl_verify$ begin\n' + '\n'.join(checks) + '\nend $rl_verify$;'])

OUT.mkdir(exist_ok=True)
manifest = []
for index, batch in enumerate(batches, 1):
    final = index == len(batches)
    name = f"{index:03d}_" + ('verificar_importacion' if final else 'estructura_y_datos' if index == 1 else 'importar_datos') + '.sql'
    header = f"-- Roboticlab: parte {index} de {len(batches)}. Ejecutar el archivo completo.\n-- No pasar a la siguiente parte si aparece un error.\nbegin;\n"
    if index == 1:
        header += SETUP
    else:
        header += f"""do $rl_order$ begin
if not exists(select 1 from public.rl_import_steps where package='{PACKAGE}' and step={index - 1})
then raise exception 'Primero ejecuta correctamente la parte {index - 1:03d}'; end if;
end $rl_order$;
"""
    footer = f"\ninsert into public.rl_import_steps(package,step) values('{PACKAGE}',{index}) on conflict do nothing;\ncommit;\n"
    footer += f"select '{'IMPORTACION COMPLETADA' if final else f'Parte {index:03d} completada. Sigue con {index + 1:03d}.'}' as resultado;\n"
    text = header + '\n'.join(batch) + footer
    data = text.encode('utf-8')
    assert len(data) < LIMIT, (name, len(data))
    (OUT / name).write_bytes(data)
    manifest.append({'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})

instructions = f"""ROBOTICLAB - IMPORTACION POR PARTES

Hay {len(manifest)} archivos SQL, todos inferiores a 450 KB.
No es necesario ejecutar el SQL grande ni el lanzador de PostgreSQL.

1. Abre 001_estructura_y_datos.sql con Bloc de notas y copia TODO su contenido.
2. En Supabase SQL Editor, crea una consulta vacia y pega ese contenido.
3. Ejecuta todo el archivo y espera al mensaje 'Parte 001 completada'.
4. Sustituye TODO el contenido del editor por el archivo 002 y ejecutalo.
5. Repite en orden hasta {manifest[-1]['file']}.
6. El ultimo debe mostrar IMPORTACION COMPLETADA. Entonces utiliza la app.

No acumules varios archivos en una misma consulta: reapareceria el limite de tamano.
Si una parte falla, detente y conserva el error. Cada parte es una transaccion:
puedes volver a ejecutar la parte fallida completa sin duplicar los datos originales.
Las partes ya terminadas se conservan. No uses la app hasta finalizar todas.
Los documentos grandes se reconstruyen automaticamente y se verifican con SHA256.
Estos archivos contienen datos privados. No subir a GitHub.

ORDEN:
""" + '\n'.join(f"{item['file']} ({item['bytes'] / 1000:.0f} KB)" for item in manifest)
(OUT / 'LEEME.txt').write_text(instructions, encoding='utf-8')
(OUT / 'manifest.json').write_text(json.dumps({'source_sha256': PACKAGE, 'files': manifest}, indent=2), encoding='utf-8')
with zipfile.ZipFile(ROOT / 'deliverables/sql-por-partes.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in [OUT / item['file'] for item in manifest] + [OUT / 'LEEME.txt', OUT / 'manifest.json']:
        archive.write(path, f'sql-por-partes/{path.name}')
print(json.dumps({'parts': len(manifest), 'largest_bytes': max(item['bytes'] for item in manifest), 'folder': str(OUT)}))
