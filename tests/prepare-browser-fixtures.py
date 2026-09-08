"""Create local-only integration fixtures, using the already-built image assets."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
output = root / '.work' / 'cases'
output.mkdir(parents=True, exist_ok=True)
raw = (root / 'dist/gallery.js').read_text(encoding='utf-8')
data = json.loads(raw.split('window.GALLERY_DATA =', 1)[1].strip().rstrip(';'))
template = (root / 'index.html').read_text(encoding='utf-8')
template = template.replace('src="config.js', 'src="/config.js').replace('href="assets/', 'href="/assets/').replace('src="assets/', 'src="/assets/')
for count in [0, 1, 21, 200, 1000]:
    items = []
    for i in range(count):
        item = json.loads(json.dumps(data['items'][i % len(data['items'])]))
        item['id'] = f'photo-{i}'
        for field in ['file', 'thumb']:
            item[field] = '/dist/' + item[field]
        for field in ['thumbnails', 'details']:
            for variant in item[field]:
                variant['file'] = '/dist/' + variant['file']
        items.append(item)
    (output / f'{count}.js').write_text('window.GALLERY_DATA = ' + json.dumps({'items': items}) + ';', encoding='utf-8')
    html = template.replace('src="gallery.js', f'src="{count}.js')
    (output / f'{count}.html').write_text(html, encoding='utf-8')

baseline = json.loads((root / 'tests/wall-baseline.json').read_text(encoding='utf-8'))
reference = json.loads((output / '21.js').read_text(encoding='utf-8').split(' = ',1)[1].rstrip(';'))
for item, dimensions in zip(reference['items'], baseline['dimensions']):
    item['width'], item['height'] = dimensions
(output / 'reference.js').write_text('window.GALLERY_DATA = ' + json.dumps(reference), encoding='utf-8')
(output / 'reference.html').write_text(template.replace('src="gallery.js', 'src="reference.js'), encoding='utf-8')

# Resource failure fixture: broken photos must remain escapable.
broken = {'items': [{'id': 'broken', 'title': 'Broken image', 'width': 400, 'height': 300, 'file': '/missing-photo.jpg'}]}
(output / 'broken.js').write_text('window.GALLERY_DATA = ' + json.dumps(broken), encoding='utf-8')
(output / 'broken.html').write_text(template.replace('src="gallery.js', 'src="broken.js'), encoding='utf-8')

# A native Image wrapper delays loading for cancellation tests only.
slow = "const RealImage=window.Image;window.Image=function(){const image=new RealImage();Object.defineProperty(image,'src',{get(){return image.getAttribute('src')||''},set(value){setTimeout(()=>image.setAttribute('src',value),3000)}});return image};"
(output / 'slow.js').write_text(slow + (output / '21.js').read_text(encoding='utf-8'), encoding='utf-8')
(output / 'slow.html').write_text(template.replace('src="gallery.js', 'src="slow.js'), encoding='utf-8')

long_item = json.loads(json.dumps(data['items'][0]))
long_item.update(id='long-title', title='A' * 180, description='A detailed photo story. ' * 25,
                 tags=['Selected work'], category='Landscape', exif={'make':'Camera', 'model':'Model ' * 20, 'lens':'Lens ' * 20, 'taken':'2026-09-05', 'iso':100, 'fnumber':'2.8'})
for field in ['file','thumb']:
    long_item[field] = '/dist/' + long_item[field]
for field in ['thumbnails','details']:
    for variant in long_item[field]: variant['file'] = '/dist/' + variant['file']
(output / 'long.js').write_text('window.GALLERY_CONFIG.showShare=true;window.GALLERY_CONFIG.showCollections=true;window.GALLERY_DATA = ' + json.dumps({'items':[long_item]}),encoding='utf-8')
(output / 'long.html').write_text(template.replace('src="gallery.js', 'src="long.js'),encoding='utf-8')
print('Created browser fixtures in', output)
