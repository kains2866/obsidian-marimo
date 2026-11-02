import {test} from 'node:test';
import assert from 'node:assert/strict';
import { decodeAttribute, extractUiElements, isSupportedWidget, labelText, optionLabels, readUiElement, tableRows, tableViewModel, tabsLabels, valueForWidget } from '../src/ui-elements.ts';

/**
 * Fixtures are the raw attribute text marimo 0.25.2 emits (captured from a real
 * kernel): JSON values in single quotes, with quotes/backslashes/dollar signs
 * HTML-escaped and `<`/`>` written as JSON `\uXXXX` escapes.
 */
const SLIDER = {
  'object-id': 'MJUe-0',
  'random-id': '0ef51e02-e23d-cd20-0f6c-576512bbf4d6',
  'data-initial-value': '3',
  'data-label': '&quot;&#92;u003cspan class=&#92;&quot;markdown prose dark:prose-invert contents&#92;&quot;&#92;u003e&#92;u003cspan class=&#92;&quot;paragraph&#92;&quot;&#92;u003eLevel&#92;u003c/span&#92;u003e&#92;u003c/span&#92;u003e&quot;',
  'data-start': '0',
  'data-stop': '10',
  'data-steps': '[]',
  'data-debounce': 'false',
  'data-disabled': 'false',
  'data-orientation': '&quot;horizontal&quot;',
  'data-show-value': 'false',
};

const DROPDOWN = {
  'object-id': 'MJUe-1',
  'random-id': '91095405-7ccb-8d87-d921-775ae27b44e2',
  'data-initial-value': '[&quot;alpha&quot;]',
  'data-label': 'null',
  'data-options': '[&quot;alpha&quot;,&quot;beta&quot;]',
  'data-allow-select-none': 'false',
  'data-searchable': 'false',
  'data-disabled': 'false',
};

test('decodes the JSON-in-attribute encoding marimo uses', () => {
  assert.equal(decodeAttribute('3'), 3);
  assert.equal(decodeAttribute('&quot;hi&quot;'), 'hi');
  assert.equal(decodeAttribute('null'), null);
  assert.equal(decodeAttribute('true'), true);
  assert.deepEqual(decodeAttribute('[&quot;alpha&quot;,&quot;beta&quot;]'), ['alpha', 'beta']);
  // `\u003c` only becomes `<` after JSON parsing, and `&#92;` is the backslash.
  assert.equal(decodeAttribute('&quot;&#92;u003cmath&#92;u003e&quot;'), '<math>');
  // A dollar sign is escaped so markdown never reads it as LaTeX.
  assert.equal(decodeAttribute('&quot;&#36;5&quot;'), '$5');
  assert.equal(decodeAttribute(undefined), undefined);
  // Anything that is not JSON stays text instead of throwing.
  assert.equal(decodeAttribute('plain'), 'plain');
});

test('reads a slider element into a typed descriptor', () => {
  const element = readUiElement('marimo-slider', SLIDER);
  assert.ok(element);
  assert.equal(element.objectId, 'MJUe-0');
  assert.equal(element.randomId, '0ef51e02-e23d-cd20-0f6c-576512bbf4d6');
  assert.equal(element.kind, 'slider');
  assert.equal(element.attrs.initialValue, 3);
  assert.equal(element.attrs.start, 0);
  assert.equal(element.attrs.stop, 10);
  assert.deepEqual(element.attrs.steps, []);
  assert.equal(element.attrs.disabled, false);
  assert.equal(labelText(element.attrs.label), 'Level');
});

test('a wrapper without an object id is not a widget', () => {
  assert.equal(readUiElement('marimo-ui-element', {'object-id': 'x'}), null);
  assert.equal(readUiElement('marimo-slider', {}), null);
  assert.equal(readUiElement('marimo-slider', {'object-id': ''}), null);
  // Ordinary HTML that merely looks like a custom element stays untouched.
  assert.equal(readUiElement('span', {'object-id': 'x'}), null);
  assert.equal(readUiElement('marimo-', {'object-id': 'x'}), null);
});

test('labels are rendered markdown, reduced to plain text for native controls', () => {
  assert.equal(labelText('<span class="markdown prose"><span class="paragraph">Pick</span></span>'), 'Pick');
  assert.equal(labelText('<span class="paragraph">a &amp; b</span>'), 'a & b');
  assert.equal(labelText(null), '');
  assert.equal(labelText(42), '');
  assert.equal(labelText('<span>  </span>'), '');
});

test('dropdown options keep their names, including mapped values', () => {
  assert.deepEqual(optionLabels(decodeAttribute(DROPDOWN['data-options'])), [
    {label: 'alpha', value: 'alpha'},
    {label: 'beta', value: 'beta'},
  ]);
  assert.deepEqual(optionLabels([{label: 'First', value: 'First'}]), [{label: 'First', value: 'First'}]);
  assert.deepEqual(optionLabels(null), []);
  assert.deepEqual(optionLabels([1, 2]), [{label: '1', value: '1'}, {label: '2', value: '2'}]);
});

test('table rows are double-encoded and must not crash on bad data', () => {
  // `data-data` carries a JSON *string* holding the rows.
  const rows = tableRows('&quot;[{&#92;&quot;a&#92;&quot;:1,&#92;&quot;b&#92;&quot;:2}]&quot;');
  assert.deepEqual(rows, [{a: 1, b: 2}]);
  assert.deepEqual(tableRows('[]'), []);
  assert.deepEqual(tableRows('not json'), []);
  assert.deepEqual(tableRows(null), []);
  assert.deepEqual(tableRows([{a: 1}]), [{a: 1}]);
});

test('tab labels come from the rendered markdown titles', () => {
  const labels = tabsLabels([
    '<span class="markdown prose"><span class="paragraph">One</span></span>',
    '<span class="markdown prose"><span class="paragraph">Two</span></span>',
  ]);
  assert.deepEqual(labels, ['One', 'Two']);
});

test('widget values match the shapes the kernel converts', () => {
  assert.equal(valueForWidget('slider', '7'), 7);
  assert.equal(valueForWidget('number', 4.5), 4.5);
  assert.deepEqual(valueForWidget('range-slider', [1, 4]), [1, 4]);
  assert.equal(valueForWidget('text', 'hello'), 'hello');
  assert.equal(valueForWidget('text-area', 'line'), 'line');
  assert.equal(valueForWidget('checkbox', true), true);
  assert.equal(valueForWidget('switch', false), false);
  assert.equal(valueForWidget('radio', 'x'), 'x');
  // A dropdown's value is the list of selected option names.
  assert.deepEqual(valueForWidget('dropdown', 'beta'), ['beta']);
  assert.deepEqual(valueForWidget('multiselect', ['a', 'b']), ['a', 'b']);
  assert.equal(valueForWidget('date', '2026-01-02'), '2026-01-02');
  assert.equal(valueForWidget('datetime', '2026-01-02T03:04'), '2026-01-02T03:04');
  // A button reports how often it was pressed, never a truthy string.
  assert.equal(valueForWidget('button', 3), 3);
  // Tabs are addressed by index.
  assert.equal(valueForWidget('tabs', 1), '1');
  // A slider value that is not a number must not become NaN in the kernel.
  assert.equal(valueForWidget('slider', ''), 0);
});

test('only widgets with a native control are claimed as supported', () => {
  for (const kind of ['slider', 'number', 'text', 'text-area', 'checkbox', 'switch', 'radio', 'dropdown', 'multiselect', 'date', 'datetime', 'button', 'tabs', 'form', 'table', 'range-slider']) {
    assert.equal(isSupportedWidget(kind), true, kind);
  }
  for (const kind of ['data-editor', 'data-explorer', 'file', 'file-browser', 'code-editor', 'matrix', 'dict', 'date-range', '', 'unknown']) {
    assert.equal(isSupportedWidget(kind), false, kind);
  }
});

/**
 * The host sanitizer drops unknown custom elements, so markup must be read from
 * the raw output string and replaced with a slot that survives sanitization.
 */
const MARKUP = "<div style='display:flex'><marimo-ui-element object-id='MJUe-0' random-id='r0'><marimo-slider data-initial-value='3' data-label='null' data-start='0' data-stop='10'></marimo-slider></marimo-ui-element></div>";

test('widget markup is lifted out before sanitizing', () => {
  const extracted = extractUiElements(MARKUP);
  assert.equal(extracted.widgets.length, 1);
  assert.equal(extracted.widgets[0].element.objectId, 'MJUe-0');
  assert.equal(extracted.widgets[0].element.kind, 'slider');
  assert.equal(extracted.widgets[0].element.attrs.initialValue, 3);
  assert.equal(extracted.widgets[0].innerHtml, '');
  assert.equal(extracted.html.includes('<marimo-'), false);
  assert.match(extracted.html, /^<div style='display:flex'><span data-widget-slot="0"><\/span><\/div>$/);
});

test('nested widgets stay inside their container', () => {
  const form = "<div><marimo-ui-element object-id='F0' random-id='rf'><marimo-form data-label='null' data-element-id=\"&quot;I0&quot;\"><marimo-ui-element object-id='I0' random-id='ri'><marimo-text data-initial-value=\"&quot;q&quot;\" data-label='null'></marimo-text></marimo-ui-element></marimo-form></marimo-ui-element></div>";
  const extracted = extractUiElements(form);
  assert.equal(extracted.widgets.length, 1, 'only the outer form is a slot');
  assert.equal(extracted.widgets[0].element.kind, 'form');
  assert.match(extracted.widgets[0].innerHtml, /object-id='I0'/);
  // The inner element is extracted when the form itself is built.
  const inner = extractUiElements(extracted.widgets[0].innerHtml);
  assert.equal(inner.widgets.length, 1);
  assert.equal(inner.widgets[0].element.kind, 'text');
});

test('several widgets keep their order, and text around them survives', () => {
  const html = `before<marimo-ui-element object-id='A'><marimo-text data-initial-value="&quot;a&quot;"></marimo-text></marimo-ui-element>middle<marimo-ui-element object-id='B'><marimo-checkbox data-initial-value='true'></marimo-checkbox></marimo-ui-element>after`;
  const extracted = extractUiElements(html);
  assert.deepEqual(extracted.widgets.map(widget => widget.element.objectId), ['A', 'B']);
  assert.equal(extracted.html, 'before<span data-widget-slot="0"></span>middle<span data-widget-slot="1"></span>after');
});

test('markup without an object id or with unbalanced tags is left alone', () => {
  assert.deepEqual(extractUiElements('<p>plain</p>'), {html: '<p>plain</p>', widgets: []});
  const noId = "<marimo-ui-element><marimo-text data-initial-value=\"&quot;a&quot;\"></marimo-text></marimo-ui-element>";
  assert.equal(extractUiElements(noId).widgets.length, 0);
  const truncated = "<marimo-ui-element object-id='X'><marimo-text></marimo-text>";
  assert.equal(extractUiElements(truncated).widgets.length, 0);
  // A lone closing tag must not confuse the scanner.
  assert.equal(extractUiElements("</marimo-ui-element>tail").html, "</marimo-ui-element>tail");
});

test('table selection writes back row indices only', () => {
  assert.deepEqual(valueForWidget('table', [2, 0, '1']), [2, 0, 1]);
  assert.deepEqual(valueForWidget('table', []), []);
  assert.deepEqual(valueForWidget('table', null), []);
  assert.deepEqual(valueForWidget('table', ['x', 1.5]), [1.5].filter(Number.isInteger));
});

test('table search and sort keep original row indices', () => {
  const rows = [
    {name: 'banana', qty: 2},
    {name: 'apple', qty: 10},
    {name: 'Cherry', qty: 7},
  ];
  // Filter by text: the surviving rows carry their original indices.
  assert.deepEqual(tableViewModel(rows, 'an', null, 50).rows.map(r => [r.index, r.cells.name]), [[0, 'banana']]);
  // Sort ascending by number: 2, 7, 10 with original indices 0, 2, 1.
  assert.deepEqual(tableViewModel(rows, '', {column: 'qty', direction: 'asc'}, 50).rows.map(r => r.index), [0, 2, 1]);
  // Descending flips it.
  assert.deepEqual(tableViewModel(rows, '', {column: 'qty', direction: 'desc'}, 50).rows.map(r => r.index), [1, 2, 0]);
  // Text sort is case-insensitive.
  assert.deepEqual(tableViewModel(rows, '', {column: 'name', direction: 'asc'}, 50).rows.map(r => r.cells.name), ['apple', 'banana', 'Cherry']);
  // Search composes with sort: 'e' matches apple (10) and Cherry (7).
  const both = tableViewModel(rows, 'e', {column: 'qty', direction: 'desc'}, 50);
  assert.deepEqual(both.rows.map(r => r.cells.name), ['apple', 'Cherry']);
  // Unknown column or empty rows degrade to the identity order.
  assert.deepEqual(tableViewModel(rows, '', {column: 'nope', direction: 'asc'}, 50).rows.map(r => r.index), [0, 1, 2]);
  assert.deepEqual(tableViewModel([], 'x', null, 50).columns, []);
  // The limit cuts the *view*, not the index mapping.
  const limited = tableViewModel(rows, '', null, 2);
  assert.equal(limited.rows.length, 2);
  assert.deepEqual(limited.rows.map(r => r.index), [0, 1]);
});

test('a dataframe element is claimed for a read-only preview', () => {
  // Its converter is a React component; the preview lists columns instead of
  // pretending to be one, so the kind must not fall into "unsupported".
  assert.equal(isSupportedWidget('dataframe'), true);
  const markup = "<marimo-ui-element object-id='d1'><marimo-dataframe data-columns='[[&quot;name&quot;,&quot;String&quot;,&quot;String&quot;],[&quot;v&quot;,&quot;Int64&quot;,&quot;Int64&quot;]]' data-dataframe-name='df' data-total='120'></marimo-dataframe></marimo-ui-element>";
  const extracted = extractUiElements(markup);
  assert.equal(extracted.widgets.length, 1);
  const element = extracted.widgets[0].element;
  assert.equal(element.kind, 'dataframe');
  assert.equal(element.attrs.dataframeName, 'df');
  assert.equal(element.attrs.total, 120);
  assert.deepEqual((element.attrs.columns as unknown[]).length, 2);
});
