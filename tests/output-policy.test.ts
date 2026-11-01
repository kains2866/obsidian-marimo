import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adaptMarimoTex, isAllowedImageSource, isBlockedAttribute, isBlockedElement} from '../src/output-policy.ts';

test('marimo tex wrappers become dollar-delimited math text',()=>{
  assert.equal(
    adaptMarimoTex('<span class="paragraph">Euler: <marimo-tex class="arithmatex">||(e^{i\\\\pi} + 1 = 0||)</marimo-tex></span>'),
    '<span class="paragraph">Euler: $e^{i\\\\pi} + 1 = 0$</span>',
  );
  assert.equal(
    adaptMarimoTex('<marimo-tex class="arithmatex">||[x^2||]</marimo-tex>'),
    '$$x^2$$',
  );
  // Malformed wrappers stay untouched; nothing is executed either way.
  assert.equal(adaptMarimoTex('<marimo-tex>oops</marimo-tex>'), '<marimo-tex>oops</marimo-tex>');
});
test('scriptable and remote-loading elements never reach the view',()=>{
  for(const tag of ['script','style','iframe','object','embed','link','img','svg','math','video','audio','source','input','button','form','textarea','select'])
    assert.equal(isBlockedElement(tag),true,tag);
});
test('structural output elements stay, including table semantics',()=>{
  for(const tag of ['div','p','span','pre','code','strong','em','h2','table','thead','tbody','tr','th','td','ul','ol','li','blockquote','br','hr','a'])
    assert.equal(isBlockedElement(tag),false,tag);
});
test('element matching ignores case and whitespace',()=>{
  assert.equal(isBlockedElement('SCRIPT'),true);
  assert.equal(isBlockedElement(' Img '),true);
  assert.equal(isBlockedElement('TABLE'),false);
});
test('inline styling and scriptable attributes are stripped',()=>{
  for(const name of ['style','class','id','name','src','srcset','href','action','onclick','onload','ONERROR'])
    assert.equal(isBlockedAttribute(name),true,name);
});
test('table layout attributes survive so outputs stay readable',()=>{
  for(const name of ['colspan','rowspan','scope','title','align','aria-label','data-testid'])
    assert.equal(isBlockedAttribute(name),false,name);
});

test('only inline raster data URLs may become images',()=>{
  assert.equal(isAllowedImageSource('data:image/png;base64,iVBORw0KGgo='),true);
  assert.equal(isAllowedImageSource('data:image/jpeg;base64,/9j/4AAQ'),true);
  assert.equal(isAllowedImageSource('data:image/gif;base64,R0lGOD'),true);
  assert.equal(isAllowedImageSource('data:image/webp;base64,UklGRg=='),true);
});
test('remote, vector and scripted image sources are refused',()=>{
  assert.equal(isAllowedImageSource('https://example.com/a.png'),false);
  assert.equal(isAllowedImageSource('http://127.0.0.1:1234/a.png'),false);
  assert.equal(isAllowedImageSource('data:image/svg+xml;base64,PHN2Zz4='),false);
  assert.equal(isAllowedImageSource('data:image/png,<svg onload="x"/>'),false);
  assert.equal(isAllowedImageSource('javascript:alert(1)'),false);
  assert.equal(isAllowedImageSource(null),false);
  assert.equal(isAllowedImageSource(''),false);
});
