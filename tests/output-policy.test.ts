import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isBlockedAttribute, isBlockedElement} from '../src/output-policy.ts';

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
