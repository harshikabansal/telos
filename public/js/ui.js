import { appendChildren, clear, el, focusFirst, trapFocus } from './dom.js';
import { icon } from './icons.js';

/* ------------------------------------------------------------------ *
 * Toasts — restrained, factual, never celebratory.
 * ------------------------------------------------------------------ */

const toastRoot = () => document.getElementById('toast-root');

export function toast(message, { tone = 'default', duration = 3600, action } = {}) {
  const node = el('div', { class: `toast${tone === 'danger' ? ' danger' : ''}`, role: 'status' }, [
    el('span', { class: 'grow', text: message }),
    action ? el('button', { type: 'button', text: action.label, onClick: () => { action.onClick(); dismiss(); } }) : null,
  ]);
  const dismiss = () => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 200);
  };
  node.style.transition = 'opacity 180ms ease, transform 180ms ease';
  toastRoot().append(node);
  const timer = setTimeout(dismiss, duration);
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  return dismiss;
}

export const notifyError = (error) =>
  toast(error?.message || 'Something went wrong.', { tone: 'danger', duration: 5200 });

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

const overlayRoot = () => document.getElementById('overlay-root');
let openModals = 0;

export function modal({ title, subtitle, body, footer, size = '', onClose, closeLabel = 'Close' }) {
  const previouslyFocused = document.activeElement;
  const overlay = el('div', { class: 'overlay' });
  const panel = el('div', { class: `modal ${size}`.trim(), role: 'dialog', 'aria-modal': 'true' });

  const heading = el('h2', { text: title, id: `modal-title-${openModals}` });
  panel.setAttribute('aria-labelledby', heading.id);

  const close = (result) => {
    overlay.remove();
    openModals -= 1;
    if (!openModals) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    untrap();
    if (previouslyFocused?.focus) previouslyFocused.focus();
    onClose?.(result);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  appendChildren(panel, [
    el('div', { class: 'modal-head' }, [
      el('div', {}, [heading, subtitle ? el('p', { class: 'small muted', text: subtitle }) : null]),
      el('button', {
        class: 'btn-icon', type: 'button', 'aria-label': closeLabel, onClick: () => close(),
      }, [icon('close')]),
    ]),
    el('div', { class: 'modal-body' }, [typeof body === 'function' ? body(close) : body]),
    footer ? el('div', { class: 'modal-foot' }, typeof footer === 'function' ? footer(close) : footer) : null,
  ]);

  overlay.append(panel);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  overlayRoot().append(overlay);
  openModals += 1;
  document.body.style.overflow = 'hidden';
  const untrap = trapFocus(panel);
  focusFirst(panel);

  return { close, panel, overlay };
}

/** A confirmation that names the consequence and, when destructive, asks for it in words. */
export function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  requireText = null,
  detail = null,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const input = requireText
      ? el('input', { class: 'input', type: 'text', placeholder: requireText, 'aria-label': `Type ${requireText}`, dataset: { autofocus: '' } })
      : null;

    const confirmButton = el('button', {
      class: `btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`,
      type: 'button',
      disabled: Boolean(requireText),
      text: confirmLabel,
      onClick: () => { settled = true; instance.close(); resolve(true); },
    });

    if (input) {
      input.addEventListener('input', () => {
        confirmButton.disabled = input.value.trim() !== requireText;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !confirmButton.disabled) confirmButton.click();
      });
    }

    const instance = modal({
      title,
      size: 'modal-sm',
      body: el('div', { class: 'stack gap-4' }, [
        el('p', { class: 'small', text: message }),
        detail ? el('div', { class: `notice ${tone === 'danger' ? 'danger' : ''}`.trim(), text: detail }) : null,
        requireText
          ? el('div', { class: 'field' }, [
              el('label', { class: 'label', text: `Type ${requireText} to confirm` }),
              input,
            ])
          : null,
      ]),
      footer: (close) => [
        el('button', { class: 'btn', type: 'button', text: cancelLabel, onClick: () => { settled = true; close(); resolve(false); } }),
        confirmButton,
      ],
      onClose: () => { if (!settled) resolve(false); },
    });
  });
}

/* ------------------------------------------------------------------ *
 * Contextual menu
 * ------------------------------------------------------------------ */

export function menu(anchor, items, { align = 'end' } = {}) {
  document.querySelectorAll('.menu').forEach((node) => node.remove());
  const node = el('div', { class: 'menu', role: 'menu' });

  for (const item of items) {
    if (!item) continue;
    if (item.separator) {
      node.append(el('div', { class: 'menu-sep' }));
      continue;
    }
    if (item.label && !item.onClick) {
      node.append(el('div', { class: 'menu-label eyebrow', text: item.label }));
      continue;
    }
    node.append(
      el('button', {
        class: `menu-item${item.danger ? ' danger' : ''}`,
        type: 'button',
        role: item.checked === undefined ? 'menuitem' : 'menuitemradio',
        ...(item.checked === undefined ? {} : { 'aria-checked': String(Boolean(item.checked)) }),
        onClick: (event) => {
          event.stopPropagation();
          close();
          item.onClick?.();
        },
      }, [
        item.icon ? icon(item.icon, { size: 16 }) : null,
        el('span', { class: 'grow', text: item.label }),
        item.hint ? el('span', { class: 'micro subtle', text: item.hint }) : null,
      ])
    );
  }

  const close = () => {
    node.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
  };
  const onOutside = (event) => {
    if (!node.contains(event.target)) close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  document.body.append(node);
  const rect = anchor.getBoundingClientRect();
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  let left = align === 'end' ? rect.right - width : rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;

  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
  }, 0);
  node.querySelector('.menu-item')?.focus();
  return close;
}

/* ------------------------------------------------------------------ *
 * Small building blocks shared by every view
 * ------------------------------------------------------------------ */

export const empty = ({ title, body, action, iconName = 'circle' }) =>
  el('div', { class: 'empty' }, [
    icon(iconName, { size: 24 }),
    el('div', { class: 'empty-title', text: title }),
    body ? el('p', { class: 'empty-body', text: body }) : null,
    action || null,
  ]);

export const meter = (percent, { tall = false, tone = '' } = {}) =>
  el('div', {
    class: `meter${tall ? ' tall' : ''}${tone ? ` ${tone}` : ''}`,
    role: 'progressbar',
    'aria-valuenow': String(Math.round(percent)),
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  }, [el('i', { style: { width: `${Math.max(0, Math.min(100, percent))}%` } })]);

export function ring(percent, size = 34) {
  const radius = size / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const wrap = el('div', { class: 'ring', style: { '--size': `${size}px` } });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const mk = (cls, offset) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', String(size / 2));
    c.setAttribute('cy', String(size / 2));
    c.setAttribute('r', String(radius));
    if (offset !== undefined) {
      c.setAttribute('stroke-dasharray', String(circumference));
      c.setAttribute('stroke-dashoffset', String(offset));
    }
    return c;
  };
  svg.append(mk('track'), mk('value', circumference * (1 - Math.max(0, Math.min(100, percent)) / 100)));
  wrap.append(svg, el('span', { text: `${Math.round(percent)}` }));
  return wrap;
}

export const chip = (text, { tone = '', iconName = null, dot = false } = {}) =>
  el('span', { class: `chip ${tone}`.trim() }, [
    dot ? el('i', { class: 'chip-dot' }) : null,
    iconName ? icon(iconName, { size: 12 }) : null,
    el('span', { text }),
  ]);

export const field = (label, control, hint) =>
  el('div', { class: 'field' }, [
    label ? el('label', { class: 'label', text: label, for: control.id || undefined }) : null,
    control,
    hint ? el('p', { class: 'hint', text: hint }) : null,
  ]);

export function select(options, { value, onChange, ariaLabel, className = 'select' } = {}) {
  const node = el('select', { class: className, 'aria-label': ariaLabel });
  for (const option of options) {
    node.append(el('option', { value: option.value, text: option.label, selected: option.value === value }));
  }
  if (onChange) node.addEventListener('change', () => onChange(node.value));
  return node;
}

export function segmented(options, { value, onChange, ariaLabel } = {}) {
  const node = el('div', { class: 'segmented', role: 'group', 'aria-label': ariaLabel });
  for (const option of options) {
    node.append(
      el('button', {
        type: 'button',
        'aria-pressed': String(option.value === value),
        onClick: () => onChange?.(option.value),
      }, [
        option.icon ? icon(option.icon, { size: 15 }) : null,
        option.label ? el('span', { text: option.label }) : null,
      ])
    );
  }
  return node;
}

export function switchRow({ label, description, checked, onChange, id }) {
  const input = el('input', { type: 'checkbox', checked, id, onChange: (e) => onChange(e.target.checked) });
  return el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-copy' }, [
      el('label', { class: 'label', text: label, for: id }),
      description ? el('p', { class: 'hint', text: description }) : null,
    ]),
    el('div', { class: 'setting-control' }, [el('label', { class: 'switch' }, [input])]),
  ]);
}

export function spinnerBlock(message = 'Loading') {
  return el('div', { class: 'empty' }, [el('p', { class: 'small muted', text: message })]);
}

/** Replaces a container's contents in one paint. */
export function render(container, content) {
  clear(container);
  appendChildren(container, Array.isArray(content) ? content : [content]);
  return container;
}
