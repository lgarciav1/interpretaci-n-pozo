"""Verifica el harness compilado de proyección con Worker real por HTTP y file://."""
import argparse, json, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', required=True)
parser.add_argument('--file', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chromium-browser'))
config = parser.parse_args()
evidence = {}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=config.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    for scheme, url in [('http', config.url), ('file', config.file.resolve().as_uri())]:
        context = browser.new_context(offline=scheme == 'file')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.goto(url)
        except Exception as error:
            if scheme == 'file' and 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(error):
                evidence[scheme] = {'status': 'blocked-by-environment', 'reason': str(error)}
                context.close()
                continue
            raise
        page.wait_for_function("['passed','failed'].includes(document.body.dataset.status)", timeout=60000)
        message = page.locator('#evidence').inner_text()
        assert page.locator('body').get_attribute('data-status') == 'passed', message
        assert not errors, errors
        evidence[scheme] = {'status': 'passed', 'result': json.loads(message), 'pageErrors': errors}
        context.close()
    browser.close()
config.output.parent.mkdir(parents=True, exist_ok=True)
config.output.write_text(json.dumps(evidence, indent=2)+'\n')
print(json.dumps(evidence))
