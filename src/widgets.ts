/**
 * Native controls for marimo's `mo.ui.*` elements.
 *
 * marimo's own frontend renders these through a React plugin registry. This
 * module reads the same markup and builds plain Obsidian DOM instead, so a
 * notebook keeps working without an embedded web view. Only widgets with a
 * faithful native counterpart are claimed; the rest are labelled, never faked.
 */
import {extractUiElements, isSupportedWidget, labelText, optionLabels, tableRows, tabsLabels, valueForWidget, type UiElement, type WidgetMarkup} from './ui-elements';

export interface WidgetDeps {
  /** Push a value to the kernel; the view owns serialisation and error handling. */
  send(objectId: string, value: unknown): void;
  translate(zh: string, en: string): string;
  /** The host sanitizer: custom elements never survive it, so nested markup is sanitized here. */
  sanitize(html: string): DocumentFragment;
}

/** A preview table is not a data grid: past this many rows it stops paying off. */
const TABLE_ROW_LIMIT = 50;
/** Text fields commit after the user stops typing, like marimo's own debounce. */
const TEXT_DEBOUNCE_MS = 400;

function node(tag: string, className: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function numberAttribute(attrs: Record<string, unknown>, name: string, fallback: number): number {
  const value = Number(attrs[name]);
  return Number.isFinite(value) ? value : fallback;
}

/** Sanitize inner markup and mount any widgets still nested inside it. */
function innerContent(html: string, deps: WidgetDeps): HTMLElement {
  const holder = node('div', 'marimo-native-widget-inner');
  if (!html) return holder;
  const extracted = extractUiElements(html);
  holder.append(deps.sanitize(extracted.html));
  mountWidgets(holder, extracted.widgets, deps);
  return holder;
}

/**
 * Replace every widget slot under `root` with a native control. The widgets were
 * lifted out of the raw output before sanitizing, so this only has to fill the
 * slots that survived.
 */
export function mountWidgets(root: HTMLElement, widgets: WidgetMarkup[], deps: WidgetDeps): void {
  for (const slot of Array.from(root.querySelectorAll('[data-widget-slot]'))) {
    const markup = widgets[Number(slot.getAttribute('data-widget-slot'))];
    if (!markup) {
      slot.remove();
      continue;
    }
    slot.replaceWith(buildWidget(markup.element, markup.innerHtml, deps));
  }
}

/** Read the current value of a native control, for form submission. */
function readControlValue(kind: string, container: Element): unknown {
  const control = container.querySelector('input, textarea, select');
  if (control instanceof HTMLInputElement) {
    if (control.type === 'checkbox') return control.checked;
    if (control.type === 'range' || control.type === 'number') return Number(control.value);
    return control.value;
  }
  if (control instanceof HTMLTextAreaElement) return control.value;
  if (control instanceof HTMLSelectElement) {
    return control.multiple ? Array.from(control.selectedOptions).map(option => option.value) : control.value;
  }
  return null;
}

function buildWidget(element: UiElement, innerHtml: string, deps: WidgetDeps): HTMLElement {
  const wrapper = node('div', 'marimo-native-widget');
  wrapper.dataset.objectId = element.objectId;
  wrapper.dataset.kind = element.kind;
  const label = labelText(element.attrs.label);
  if (label) {
    const caption = node('div', 'marimo-native-widget-label');
    caption.textContent = label;
    wrapper.append(caption);
  }
  if (element.kind === 'anywidget') {
    // An anywidget runs a JavaScript model this view cannot host. marimo also
    // emits one from the plain `import marimo as mo` cell, so a note here would
    // show up in every notebook; an empty wrapper keeps the slot quiet.
    return wrapper;
  }
  if (!isSupportedWidget(element.kind)) {
    const note = node('div', 'marimo-native-widget-unsupported');
    note.textContent = deps.translate('此组件暂未适配：', 'Widget not supported yet: ') + element.kind;
    wrapper.append(note);
    return wrapper;
  }
  const disabled = element.attrs.disabled === true;
  const send = (value: unknown) => deps.send(element.objectId, valueForWidget(element.kind, value));
  const attrs = element.attrs;

  switch (element.kind) {
    case 'slider':
    case 'range-slider': {
      const steps = Array.isArray(attrs.steps) ? attrs.steps.map(Number).filter(Number.isFinite) : [];
      const start = steps.length ? steps[0] : numberAttribute(attrs, 'start', 0);
      const stop = steps.length ? steps[steps.length - 1] : numberAttribute(attrs, 'stop', 100);
      const step = steps.length > 1 ? Math.abs(steps[1] - steps[0]) : 1;
      const initial = Array.isArray(attrs.initialValue) ? attrs.initialValue.map(Number) : [numberAttribute(attrs, 'initialValue', start)];
      if (element.kind === 'slider') {
        const range = document.createElement('input');
        range.type = 'range';
        range.className = 'marimo-native-widget-range';
        range.min = String(Math.min(start, stop));
        range.max = String(Math.max(start, stop));
        range.step = String(step || 1);
        range.value = String(initial[0] ?? start);
        range.disabled = disabled;
        const readout = node('span', 'marimo-native-widget-value');
        readout.textContent = range.value;
        range.addEventListener('input', () => { readout.textContent = range.value; });
        // Commit on release: every commit is a full reactive cycle.
        range.addEventListener('change', () => send(Number(range.value)));
        wrapper.append(range, readout);
      } else {
        const pair = node('div', 'marimo-native-widget-range-pair');
        const bounds = [0, 1].map(index => {
          const input = document.createElement('input');
          input.type = 'number';
          input.className = 'marimo-native-widget-number';
          input.min = String(Math.min(start, stop));
          input.max = String(Math.max(start, stop));
          input.step = String(step || 1);
          input.value = String(initial[index] ?? start);
          input.disabled = disabled;
          input.setAttribute('aria-label', index === 0 ? 'min' : 'max');
          pair.append(input);
          return input;
        });
        bounds.forEach(input => input.addEventListener('change', () => send([Number(bounds[0].value), Number(bounds[1].value)])));
        wrapper.append(pair);
      }
      break;
    }
    case 'number': {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'marimo-native-widget-number';
      // Open-ended numbers keep the browser's own bounds instead of "Infinity".
      const min = Number(attrs.start);
      const max = Number(attrs.stop);
      if (Number.isFinite(min)) input.min = String(min);
      if (Number.isFinite(max)) input.max = String(max);
      input.value = String(numberAttribute(attrs, 'initialValue', 0));
      input.disabled = disabled;
      input.addEventListener('change', () => send(input.value === '' ? null : Number(input.value)));
      wrapper.append(input);
      break;
    }
    case 'text':
    case 'text-area': {
      const input = element.kind === 'text' ? document.createElement('input') : document.createElement('textarea');
      if (input instanceof HTMLInputElement) input.type = 'text';
      else input.rows = 3;
      input.className = element.kind === 'text' ? 'marimo-native-widget-text' : 'marimo-native-widget-textarea';
      input.value = typeof attrs.initialValue === 'string' ? attrs.initialValue : '';
      input.placeholder = typeof attrs.placeholder === 'string' ? attrs.placeholder : '';
      input.disabled = disabled;
      let timer: number | null = null;
      const commit = () => {
        if (timer !== null) {window.clearTimeout(timer); timer = null;}
        send(input.value);
      };
      input.addEventListener('input', () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(commit, TEXT_DEBOUNCE_MS);
      });
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (event: Event) => {
        const key = event as KeyboardEvent;
        if (key.key === 'Enter' && (element.kind === 'text' || key.metaKey || key.ctrlKey)) {key.preventDefault(); commit();}
      });
      wrapper.append(input);
      break;
    }
    case 'checkbox':
    case 'switch': {
      const row = node('label', 'marimo-native-widget-toggle');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = element.kind === 'switch' ? 'marimo-native-widget-switch' : 'marimo-native-widget-checkbox';
      input.checked = attrs.initialValue === true;
      input.disabled = disabled;
      input.addEventListener('change', () => send(input.checked));
      row.append(input);
      wrapper.append(row);
      break;
    }
    case 'radio': {
      const group = node('div', 'marimo-native-widget-radios');
      group.setAttribute('role', 'radiogroup');
      const current = typeof attrs.initialValue === 'string' ? attrs.initialValue : '';
      for (const option of optionLabels(attrs.options)) {
        const row = node('label', 'marimo-native-widget-radio');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = element.objectId;
        input.value = option.value;
        input.checked = option.value === current;
        input.disabled = disabled;
        input.addEventListener('change', () => {if (input.checked) send(option.value);});
        const text = document.createElement('span');
        text.textContent = option.label;
        row.append(input, text);
        group.append(row);
      }
      wrapper.append(group);
      break;
    }
    case 'dropdown': {
      const select = document.createElement('select');
      select.className = 'dropdown marimo-native-widget-select';
      const current = Array.isArray(attrs.initialValue) ? String(attrs.initialValue[0] ?? '') : '';
      if (attrs.allowSelectNone === true) {
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '—';
        select.append(none);
      }
      for (const option of optionLabels(attrs.options)) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        node.selected = option.value === current;
        select.append(node);
      }
      select.disabled = disabled;
      select.addEventListener('change', () => send(select.value === '' ? null : select.value));
      wrapper.append(select);
      break;
    }
    case 'multiselect': {
      const select = document.createElement('select');
      select.className = 'dropdown mod-multi-select marimo-native-widget-select';
      select.multiple = true;
      select.size = Math.min(Math.max(optionLabels(attrs.options).length, 3), 8);
      const current = Array.isArray(attrs.initialValue) ? attrs.initialValue.map(String) : [];
      for (const option of optionLabels(attrs.options)) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        node.selected = current.includes(option.value);
        select.append(node);
      }
      select.disabled = disabled;
      select.addEventListener('change', () => send(Array.from(select.selectedOptions).map(option => option.value)));
      wrapper.append(select);
      break;
    }
    case 'date':
    case 'datetime': {
      const input = document.createElement('input');
      input.type = element.kind === 'date' ? 'date' : 'datetime-local';
      input.className = 'marimo-native-widget-date';
      const initial = typeof attrs.initialValue === 'string' ? attrs.initialValue : '';
      // `datetime-local` has no seconds field; the kernel accepts minute precision.
      input.value = element.kind === 'date' ? initial.slice(0, 10) : initial.slice(0, 16);
      input.disabled = disabled;
      input.addEventListener('change', () => send(input.value));
      wrapper.append(input);
      break;
    }
    case 'button': {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'marimo-native-widget-button';
      button.textContent = label || deps.translate('运行', 'Run');
      button.disabled = disabled;
      let clicks = numberAttribute(attrs, 'initialValue', 0);
      button.addEventListener('click', () => {clicks += 1; send(clicks);});
      wrapper.append(button);
      break;
    }
    case 'tabs': {
      const labels = tabsLabels(attrs.tabs);
      const holder = innerContent(innerHtml, deps);
      const panes = Array.from(holder.querySelectorAll('[data-kind="tab"]')) as HTMLElement[];
      const bar = node('div', 'marimo-native-widget-tab-bar');
      const body = node('div', 'marimo-native-widget-tab-body');
      let active = Math.min(Math.max(Number(attrs.initialValue) || 0, 0), Math.max(labels.length - 1, 0));
      const buttons = labels.map((title, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'marimo-native-widget-tab';
        button.textContent = title;
        button.disabled = disabled;
        button.addEventListener('click', () => {
          if (index === active) return;
          active = index;
          buttons.forEach((each, position) => each.classList.toggle('is-active', position === index));
          panes.forEach((pane, position) => {pane.classList.toggle('is-hidden', position !== index);});
          send(index);
        });
        bar.append(button);
        return button;
      });
      buttons.forEach((button, index) => button.classList.toggle('is-active', index === active));
      panes.forEach((pane, index) => {pane.classList.add('marimo-native-widget-tab-pane'); pane.classList.toggle('is-hidden', index !== active); body.append(pane);});
      wrapper.append(bar, body);
      break;
    }
    case 'form': {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'marimo-native-widget-form';
      // The form's inner markup holds the element it submits.
      const holder = innerContent(innerHtml, deps);
      const inner = holder.querySelector<HTMLElement>('.marimo-native-widget');
      if (inner) fieldset.append(inner);
      const innerKind = inner?.dataset.kind ?? '';
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'marimo-native-widget-button mod-cta';
      submit.textContent = typeof attrs.submitButtonLabel === 'string' && attrs.submitButtonLabel ? attrs.submitButtonLabel : deps.translate('提交', 'Submit');
      submit.disabled = disabled || attrs.submitButtonDisabled === true || !inner;
      submit.addEventListener('click', () => {
        if (!inner) return;
        // A form's value is its element's value; marimo converts it the same way.
        deps.send(element.objectId, valueForWidget(innerKind, readControlValue(innerKind, inner)));
      });
      fieldset.append(submit);
      wrapper.append(fieldset);
      break;
    }
    case 'table': {
      const rows = tableRows(attrs.data);
      const table = document.createElement('table');
      table.className = 'marimo-native-widget-table';
      const columns = rows.length ? Object.keys(rows[0]) : [];
      if (columns.length) {
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const column of columns) {
          const cell = document.createElement('th');
          cell.textContent = column;
          headRow.append(cell);
        }
        head.append(headRow);
        table.append(head);
        const body = document.createElement('tbody');
        for (const row of rows.slice(0, TABLE_ROW_LIMIT)) {
          const line = document.createElement('tr');
          for (const column of columns) {
            const cell = document.createElement('td');
            const value = row[column];
            cell.textContent = value === null || value === undefined ? '' : String(value);
            line.append(cell);
          }
          body.append(line);
        }
        table.append(body);
      }
      wrapper.append(table);
      const total = numberAttribute(attrs, 'totalRows', rows.length);
      if (total > TABLE_ROW_LIMIT) {
        const note = node('div', 'marimo-native-widget-note');
        note.textContent = deps.translate(`仅显示前 ${TABLE_ROW_LIMIT} 行，共 ${total} 行`, `Showing the first ${TABLE_ROW_LIMIT} of ${total} rows`);
        wrapper.append(note);
      }
      if (!columns.length) {
        const note = node('div', 'marimo-native-widget-note');
        note.textContent = deps.translate('空表格', 'Empty table');
        wrapper.append(note);
      }
      break;
    }
    default:
      break;
  }
  return wrapper;
}
