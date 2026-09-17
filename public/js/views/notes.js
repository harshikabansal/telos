import api from '../api.js';
import { clear, debounce, el } from '../dom.js';
import { icon } from '../icons.js';
import { confirmDialog, empty, menu, notifyError, select, toast } from '../ui.js';
import { timeAgo } from '../dates.js';
import { buildQuery, navigate } from '../router.js';
import { state } from '../store.js';
import { page } from '../shell.js';

/**
 * Notes. A quiet place for thinking, kept beside the plan rather than inside
 * it. Edits save themselves after a pause; nothing needs a save button.
 */
export async function notesView({ query = {} } = {}) {
  const data = await api.get('/notes', { areaId: query.areaId, q: query.q });
  const notes = data.notes;
  const selectedId = query.id && notes.some((n) => n.id === query.id) ? query.id : notes[0]?.id ?? null;

  const go = (changes) => navigate(`/notes${buildQuery({ ...query, ...changes })}`, { replace: true });
  const refresh = () => go({});

  const editorPane = el('div', { class: 'card', style: { minHeight: '420px' } });

  async function createNote() {
    try {
      const result = await api.post('/notes', { title: 'Untitled note', body: '' });
      toast('Note created.');
      go({ id: result.note.id });
    } catch (error) {
      notifyError(error);
    }
  }

  function renderEditor(note) {
    clear(editorPane);
    if (!note) {
      editorPane.append(
        empty({
          iconName: 'notes',
          title: notes.length ? 'Choose a note.' : 'Nothing written yet.',
          body: notes.length
            ? 'Select a note from the list to read or edit it.'
            : 'Notes hold the thinking behind the plan — reflections, references, anything you want to keep.',
          action: notes.length
            ? null
            : el('button', {
                class: 'btn btn-sm', type: 'button', style: { marginTop: '12px' }, onClick: createNote,
              }, [el('span', { text: 'Write a note' })]),
        })
      );
      return;
    }

    const status = el('span', { class: 'micro subtle', text: `Edited ${timeAgo(note.updatedAt)}` });

    const save = debounce(async (payload) => {
      try {
        status.textContent = 'Saving…';
        const result = await api.patch(`/notes/${note.id}`, payload);
        status.textContent = `Saved ${timeAgo(result.note.updatedAt)}`;
      } catch (error) {
        status.textContent = 'Not saved';
        notifyError(error);
      }
    }, 700);

    const titleInput = el('input', {
      class: 'input',
      style: {
        border: 'none', padding: '0', fontSize: '1.25rem',
        fontFamily: 'var(--font-serif)', background: 'transparent',
      },
      value: note.title,
      placeholder: 'Untitled note',
      maxlength: '200',
      onInput: (event) => save({ title: event.target.value }),
    });

    const bodyInput = el('textarea', {
      class: 'textarea',
      style: { border: 'none', padding: '0', minHeight: '340px', background: 'transparent', lineHeight: '1.7' },
      placeholder: 'Write freely.',
      onInput: (event) => save({ body: event.target.value }),
    }, note.body);

    editorPane.append(
      el('div', { class: 'row gap-3', style: { marginBottom: '12px' } }, [
        el('div', { class: 'grow' }, [titleInput]),
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': 'Note options',
          onClick: (event) => menu(event.currentTarget, [
            {
              label: note.pinned ? 'Unpin' : 'Pin to top',
              icon: 'important',
              onClick: async () => {
                await api.patch(`/notes/${note.id}`, { pinned: !note.pinned }).catch(notifyError);
                refresh();
              },
            },
            { separator: true },
            { label: 'Link to an area' },
            ...state.areas.slice(0, 8).map((area) => ({
              label: area.name,
              checked: note.areaId === area.id,
              onClick: async () => {
                await api.patch(`/notes/${note.id}`, { areaId: note.areaId === area.id ? null : area.id }).catch(notifyError);
                refresh();
              },
            })),
            { separator: true },
            {
              label: 'Delete note', icon: 'trash', danger: true,
              onClick: async () => {
                const ok = await confirmDialog({
                  title: 'Delete this note?',
                  message: 'This cannot be undone.',
                  confirmLabel: 'Delete', tone: 'danger',
                });
                if (!ok) return;
                try {
                  await api.del(`/notes/${note.id}`);
                  toast('Note deleted.');
                  go({ id: undefined });
                } catch (error) {
                  notifyError(error);
                }
              },
            },
          ]),
        }, [icon('more', { size: 18 })]),
      ]),
      el('div', { class: 'row gap-3', style: { marginBottom: '16px' } }, [
        status,
        note.areaId
          ? el('span', { class: 'chip', text: state.areas.find((a) => a.id === note.areaId)?.name ?? 'Area' })
          : null,
      ]),
      bodyInput
    );
  }

  const listPane = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('span', { class: 'eyebrow', text: `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}` }),
      el('button', {
        class: 'btn btn-sm', type: 'button', onClick: createNote,
      }, [icon('plus', { size: 14 }), el('span', { text: 'New' })]),
    ]),
    notes.length
      ? el('div', { class: 'rows', style: { maxHeight: '520px', overflowY: 'auto' } },
          notes.map((note) =>
            el('button', {
              class: 'list-row',
              type: 'button',
              style: note.id === selectedId ? { background: 'var(--surface-2)' } : {},
              onClick: () => go({ id: note.id }),
            }, [
              el('div', { class: 'stack grow', style: { minWidth: '0' } }, [
                el('span', { class: 'small truncate', text: note.title || 'Untitled note' }),
                el('span', { class: 'micro subtle truncate', text: note.body.slice(0, 80) || 'Empty' }),
                el('span', { class: 'micro subtle', text: timeAgo(note.updatedAt) }),
              ]),
              note.pinned ? icon('important', { size: 13 }) : null,
            ])
          )
        )
      : el('p', { class: 'hint', style: { padding: '16px' }, text: 'No notes yet.' }),
  ]);

  renderEditor(notes.find((n) => n.id === selectedId) ?? null);

  return page({
    title: 'Notes',
    subtitle: 'The thinking behind the plan.',
    actions: [
      select(
        [{ value: '', label: 'All areas' }, ...state.areas.map((a) => ({ value: a.id, label: a.name }))],
        { value: query.areaId || '', ariaLabel: 'Filter by area', onChange: (v) => go({ areaId: v || undefined, id: undefined }) }
      ),
      el('button', { class: 'btn btn-primary', type: 'button', onClick: createNote },
        [icon('plus', { size: 15 }), el('span', { text: 'New note' })]),
    ],
    children: el('div', { class: 'split' }, [editorPane, listPane]),
  });
}

export default notesView;
