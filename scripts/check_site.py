"""Check rendered blog routes, local assets, links, and RSS without extra packages."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

root = Path('_site').resolve()
errors = []

class Links(HTMLParser):
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for attr in ('href', 'src'):
            value = attrs.get(attr, '')
            url = urlsplit(value)
            if not value or url.scheme or url.netloc or value.startswith('#'):
                continue
            target = (root / unquote(url.path).lstrip('/') if url.path.startswith('/')
                      else self.page.parent / unquote(url.path))
            if not (target.is_file() or (target / 'index.html').is_file()
                    or target.with_suffix('.html').is_file()):
                errors.append(f'{self.page.relative_to(root)}: missing {value}')

for path in root.rglob('*.html'):
    parser = Links()
    parser.page = path
    parser.feed(path.read_text())
for route in ('index.html', 'aboutme/index.html', 'tags/index.html', '404.html',
              '2021-06-09-neo4j-aad/index.html', 'sitemap.xml'):
    if not (root / route).is_file():
        errors.append(f'Missing required route: {route}')
feed = ET.parse(root / 'feed.xml')
if not feed.findall('./channel/item'):
    errors.append('RSS feed contains no posts')
if errors:
    raise SystemExit('\n'.join(errors))
print('PASS: required routes, internal links, images, and RSS feed')
