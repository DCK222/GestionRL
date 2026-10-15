"""Run after scripts/print-check.tsx with the bundled Python PDF dependencies."""
from pathlib import Path
import pdfplumber

folder = Path(__file__).resolve().parents[1] / 'private-import/print-review'
for name in ['short', 'long', 'dark-mobile']:
    with pdfplumber.open(folder / f'{name}.pdf') as pdf:
        texts = [page.extract_text() or '' for page in pdf.pages]
        text = '\n'.join(texts)
        assert len(pdf.pages) == 1 if name != 'long' else len(pdf.pages) > 1
        assert 'Roboticlab · Gestión' not in text
        assert 'print-check.invalid' not in text
        assert 'NO IMPRIMIR' not in text
        assert 'ROBOTICLAB' in texts[-1]
        assert 'Asociación Canal Sénior' in text
        if name == 'long':
            for index in range(1, 56):
                assert f'Concepto {index:02d}' in text
        else:
            assert 'químicas' in text
            assert '85,00' in text
        for page in pdf.pages:
            assert abs(float(page.width) - 595.3) < 1
            assert abs(float(page.height) - 841.9) < 1
            # No clipped text or content against the printer's physical edge.
            for word in page.extract_words():
                assert word['x0'] >= 30 and word['x1'] <= float(page.width) - 30, word
                assert word['top'] >= 25 and word['bottom'] <= float(page.height) - 25, word
        print(f'PASS {name}: {len(pdf.pages)} page(s), full content, safe margins, no browser headers.')
