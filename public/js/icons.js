/**
 * Professional stroke iconography. TELOS uses no emoji anywhere in its own
 * interface — only these line icons, drawn on a 24px grid at 1.5px weight.
 * The markup here is static and internal; it is the only HTML injected
 * verbatim anywhere in the client.
 */

const PATHS = {
  // Navigation
  overview: '<path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7.2 4.6M3.5 12l1.2 1.2 2.5-2.6M3.5 18l1.2 1.2 2.5-2.6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  important: '<path d="M5 21V4.5a.5.5 0 0 1 .3-.46C6.6 3.5 8.2 3.2 9.8 3.9c2.2.95 4.2 1.4 6.4.5l1.6-.65a.5.5 0 0 1 .7.46v8.3a.5.5 0 0 1-.3.46l-1.5.62c-2.2.9-4.2.45-6.4-.5-1.6-.7-3.2-.4-4.5.14"/>',
  recurring: '<path d="M4 11a8 8 0 0 1 13.3-5.9L20 7.5"/><path d="M20 4v3.5h-3.5"/><path d="M20 13a8 8 0 0 1-13.3 5.9L4 16.5"/><path d="M4 20v-3.5h3.5"/>',
  projects: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5v-10Z"/>',
  objectives: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  insights: '<path d="M4 20V9M10 20V4M16 20v-7M22 20H2"/>',
  notes: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h4"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  milestone: '<path d="M6 21V4"/><path d="M6 5h11l-2 3.5L17 12H6"/>',

  // Actions
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 15V6a2 2 0 0 1 2-2h9"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  sort: '<path d="M7 5v14M4 16l3 3 3-3"/><path d="M14 8h6M14 12h4M14 16h2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 4.5 2.8 20h18.4L12 4.5Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
  link: '<path d="M10 13.5a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M14 10.5a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.5-1.5"/>',
  external: '<path d="M13 5h6v6"/><path d="M19 5 10 14"/><path d="M18 14v5H5V6h5"/>',
  drag: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',

  // Chevrons & arrows
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  arrowRight: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  arrowLeft: '<path d="M20 12H4M10 18l-6-6 6-6"/>',
  arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',

  // Views
  list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="16" y="4" width="5" height="16" rx="1.5"/>',
  timeline: '<path d="M4 7h9M4 12h14M4 17h6"/><circle cx="15" cy="7" r="1.5"/><circle cx="20" cy="12" r="1.5"/><circle cx="12" cy="17" r="1.5"/>',

  // Account & security
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  shield: '<path d="M12 3.5 5 6.2v5.5c0 4 3 7.4 7 8.8 4-1.4 7-4.8 7-8.8V6.2L12 3.5Z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20M17 12v3M20 12v2.5"/>',
  logout: '<path d="M14 5H6v14h8"/><path d="M17 8.5 20.5 12 17 15.5M20.5 12H10"/>',
  download: '<path d="M12 4v11M8 11.5l4 4 4-4"/><path d="M4 19h16"/>',
  upload: '<path d="M12 19V8M8 11.5l4-4 4 4"/><path d="M4 19h16" opacity="0"/><path d="M4 20h16"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"/>',
  device: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.5 9.6A2.6 2.6 0 0 0 12 14.6c.7 0 1.3-.3 1.8-.7"/><path d="M6.3 6.6C3.9 8.2 2.5 12 2.5 12s3.5 6 9.5 6c1.6 0 3-.4 4.2-1"/><path d="M18.4 15.3c1.9-1.6 3.1-3.3 3.1-3.3S18 6 12 6c-.7 0-1.3.1-1.9.2"/>',

  // Theme
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',

  // Areas of life
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16H6.5A1.5 1.5 0 0 0 5 20.5v-16Z"/><path d="M5 17.5A1.5 1.5 0 0 1 6.5 16H19"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18"/>',
  coins: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/><path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  heart: '<path d="M12 20s-7.5-4.5-7.5-9.5A4 4 0 0 1 12 7.6 4 4 0 0 1 19.5 10.5C19.5 15.5 12 20 12 20Z"/>',
  activity: '<path d="M3 12h4l2.5-6 4 12L16 12h5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15 9-1.8 4.2L9 15l1.8-4.2L15 9Z"/>',
  lightbulb: '<path d="M9.5 17.5a5.5 5.5 0 1 1 5 0v1.5h-5v-1.5Z"/><path d="M10 21h4"/>',
  sparkle: '<path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9 12 3.5Z"/><path d="M18 17l.7 2.3L21 20l-2.3.7L18 23l-.7-2.3L15 20l2.3-.7L18 17Z"/>',
  home: '<path d="m4 10.5 8-6 8 6V20h-5v-6h-6v6H4V10.5Z"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.7-1.6h1.5A4.5 4.5 0 0 0 20.5 10c0-3.6-3.8-6.5-8.5-6.5Z"/><circle cx="8" cy="10" r="1.1"/><circle cx="12" cy="7.5" r="1.1"/><circle cx="16" cy="10" r="1.1"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-13 0 9-5 13-11 13H5Z"/><path d="M8 16c2-3 4.5-5 8-6"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.2 2.4 3.4 5.4 3.4 8.5s-1.2 6.1-3.4 8.5c-2.2-2.4-3.4-5.4-3.4-8.5S9.8 5.9 12 3.5Z"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5v-10Z"/>',
  inbox: '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M4.5 13 6 5h12l1.5 8v6h-15v-6Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-.5 4"/><path d="M20 5v6h-6" opacity="0"/><path d="M14 11h6V5"/>',
  flag: '<path d="M6 21V4h12l-2.5 4L18 12H6"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  file: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Returns an <svg> element for the named icon. */
export function icon(name, { size = 18, className = '' } = {}) {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.5');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('width', String(size));
  node.setAttribute('height', String(size));
  node.setAttribute('class', `icon ${className}`.trim());
  node.innerHTML = PATHS[name] || PATHS.circle;
  return node;
}

export const hasIcon = (name) => Boolean(PATHS[name]);
export default icon;
