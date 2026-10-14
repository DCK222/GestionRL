from pathlib import Path
import zipfile,json,hashlib,shutil
root=Path(__file__).resolve().parents[1]
out=root/'deliverables';out.mkdir(exist_ok=True)
files=[root/n for n in ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.ts','render.yaml','README.md','.gitignore','.env.example']]
for folder in ['src','public','docs','tests']:
 files.extend(p for p in (root/folder).rglob('*') if p.is_file())
files.extend(root/'scripts'/n for n in ['test-database.ts','validate_xml.py','import-supabase.ps1'])
shutil.copy2(root/'scripts/import-supabase.ps1',out/'import-supabase.ps1')
with zipfile.ZipFile(out/'roboticlab-aplicacion.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in files:z.write(p,p.relative_to(root).as_posix())
shutil.copy2(root/'render.yaml',out/'render.yaml')
shutil.copy2(root/'README.md',out/'LEEME-INSTALACION.md')
manifest={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in out.iterdir() if p.is_file() and p.name!='manifest.json'}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
with zipfile.ZipFile(out/'roboticlab-aplicacion.zip') as z:
 assert 'render.yaml' in z.namelist() and 'src/app/page.tsx' in z.namelist()
 assert not any('.env.local' in n or 'private-import' in n or n.endswith('.sql') for n in z.namelist())
 print(json.dumps({'archive_files':len(z.namelist()),'deliverables':{k:v['bytes'] for k,v in manifest.items()}},indent=2))
