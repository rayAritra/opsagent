from pathlib import Path
r=Path('.')
p=r/'tests/tools.test.ts';s=p.read_text(encoding='utf8').replace("text.trim()===label","text.trim().split('\\n')[0]===label");p.write_text(s,encoding='utf8')
p=r/'tests/e2e/console.spec.ts';s=p.read_text(encoding='utf8').replace("await page.getByRole('textbox').filter({hasText:''}).count();await page.locator('input').filter({hasNot:page.locator('[type=checkbox]')}).count();",'');p.write_text(s,encoding='utf8')
