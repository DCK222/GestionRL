"""Run after student-print-check.tsx with the bundled PDF dependencies."""
from pathlib import Path
import logging
import pdfplumber

logging.getLogger('pdfminer').setLevel(logging.ERROR)
folder = Path(__file__).resolve().parents[1] / 'private-import/print-review'
for name in ['student-short', 'student-long', 'student-empty']:
    with pdfplumber.open(folder / f'{name}.pdf') as pdf:
        text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        assert len(pdf.pages) == 1 if name != 'student-long' else len(pdf.pages) > 1
        assert 'Roboticlab · Gestión' not in text
        assert 'student-check.invalid' not in text
        assert 'NO IMPRIMIR' not in text
        assert 'Alumno de prueba' in text
        assert 'No sustituye a una factura' in text
        assert 'Registro mensual' in text
        if name == 'student-empty':
            assert 'Sin días anotados.' in text
            assert 'Sin cobros desglosados.' in text
        else:
            assert 'M6 M13 M20 M27' in text
            assert '60,00' in text and '10,00' in text
            for index in range(1, 56 if name == 'student-long' else 5):
                assert f'Sesión {index:02d}' in text
        for page in pdf.pages:
            assert abs(float(page.width) - 595.3) < 1
            assert abs(float(page.height) - 841.9) < 1
            for word in page.extract_words():
                assert word['x0'] >= 30 and word['x1'] <= float(page.width) - 30, word
                assert word['top'] >= 25 and word['bottom'] <= float(page.height) - 25, word
        print(f'PASS {name}: {len(pdf.pages)} page(s), all content, safe margins, no browser headers or private notes.')
