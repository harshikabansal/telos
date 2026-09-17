import api from '../api.js';
import { el } from '../dom.js';
import { icon } from '../icons.js';
import { field, notifyError, toast } from '../ui.js';
import { navigate } from '../router.js';
import { setUser } from '../store.js';

/* ------------------------------------------------------------------ *
 * Shared frame
 * ------------------------------------------------------------------ */

const LADDER = ['Purpose', 'Objective', 'Milestone', 'Project', 'Responsibility', 'Today'];

function authFrame(card) {
  return el('div', { class: 'auth' }, [
    el('aside', { class: 'auth-aside' }, [
      el('div', { class: 'brand-mark', text: 'TELOS' }),
      el('div', { class: 'auth-quote' }, [
        el('h2', { text: 'Live with intention. Move with purpose.' }),
        el('p', { class: 'small muted', text: 'A personal system that connects the small things you do each day with the larger life you are building.' }),
        el('ul', { class: 'auth-ladder', style: { marginTop: '28px' } },
          LADDER.map((label, index) =>
            el('li', { style: { '--i': String(index) } }, [el('span', { text: label })])
          )
        ),
      ]),
      el('p', { class: 'micro subtle', text: 'From intention to action.' }),
    ]),
    el('main', { class: 'auth-main', id: 'main' }, [card]),
  ]);
}

function passwordField(labelText, { name, autocomplete, onInput, hint } = {}) {
  const input = el('input', {
    class: 'input', type: 'password', name, autocomplete, required: true,
    style: { paddingRight: '40px' },
  });
  const toggle = el('button', {
    class: 'btn-icon sm', type: 'button', 'aria-label': 'Show password',
    style: { position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)' },
    onClick: (event) => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      event.currentTarget.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      event.currentTarget.replaceChildren(icon(showing ? 'eye' : 'eyeOff', { size: 16 }));
    },
  }, [icon('eye', { size: 16 })]);
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  const wrap = el('div', { style: { position: 'relative' } }, [input, toggle]);
  return { input, node: field(labelText, wrap, hint) };
}

function strengthMeter() {
  const node = el('div', { class: 'strength', dataset: { score: '0' } }, [
    el('span'), el('span'), el('span'), el('span'),
  ]);
  const label = el('p', { class: 'hint', text: 'At least 10 characters, using three of: lowercase, uppercase, numbers, symbols.' });
  const update = (value) => {
    let score = 0;
    if (value.length >= 10) score += 1;
    if (value.length >= 14) score += 1;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
    if (classes >= 3) score += 1;
    if (classes === 4 && value.length >= 12) score += 1;
    node.dataset.score = String(Math.min(4, score));
    label.textContent = !value
      ? 'At least 10 characters, using three of: lowercase, uppercase, numbers, symbols.'
      : ['Too short.', 'Weak.', 'Reasonable.', 'Strong.', 'Very strong.'][Math.min(4, score)];
  };
  return { node: el('div', { class: 'stack gap-1' }, [node, label]), update };
}

function errorBox() {
  const node = el('div', { class: 'notice danger', role: 'alert', style: { display: 'none' } });
  return {
    node,
    show: (message) => {
      node.textContent = message;
      node.style.display = 'block';
    },
    hide: () => {
      node.style.display = 'none';
    },
  };
}

async function withProviders(container) {
  try {
    const { providers } = await api.providers();
    if (!providers.length) return;
    container.append(
      el('div', { class: 'divider', style: { margin: '20px 0' } }, [el('span', { text: 'or' })]),
      ...providers.map((provider) =>
        el('a', {
          class: 'btn btn-block', href: `/api/auth/oauth/${provider.id}`, style: { marginBottom: '8px' },
        }, [el('span', { text: provider.label })])
      )
    );
  } catch { /* providers are optional */ }
}

/* ------------------------------------------------------------------ *
 * Sign in
 * ------------------------------------------------------------------ */

export function loginView() {
  const error = errorBox();
  const password = passwordField('Password', { name: 'password', autocomplete: 'current-password' });
  const emailInput = el('input', {
    class: 'input', type: 'email', name: 'email', autocomplete: 'email',
    required: true, dataset: { autofocus: '' }, placeholder: 'you@example.com',
  });
  const remember = el('input', { type: 'checkbox', name: 'remember' });
  const submit = el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit', text: 'Sign in' });

  const form = el('form', { class: 'auth-form', novalidate: true }, [
    error.node,
    field('Email', emailInput),
    password.node,
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      el('label', { class: 'checkbox' }, [remember, el('span', { class: 'checkbox-label', text: 'Remember me' })]),
      el('a', { class: 'link small', href: '#/forgot', text: 'Forgot password' }),
    ]),
    submit,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hide();
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const result = await api.login({
        email: emailInput.value.trim(),
        password: password.input.value,
        remember: remember.checked,
      });
      setUser(result.user);
      navigate(result.user.onboarded ? '/' : '/welcome', { replace: true });
    } catch (err) {
      error.show(err.message);
      submit.disabled = false;
      submit.textContent = 'Sign in';
      password.input.focus();
    }
  });

  const card = el('div', { class: 'auth-card' }, [
    el('h1', { text: 'Welcome back' }),
    el('p', { class: 'muted small', text: 'Sign in to continue where you left off.' }),
    form,
    el('p', { class: 'auth-alt' }, [
      el('span', { text: 'New to TELOS? ' }),
      el('a', { href: '#/register', text: 'Create an account' }),
    ]),
  ]);
  withProviders(form);
  return authFrame(card);
}

/* ------------------------------------------------------------------ *
 * Register
 * ------------------------------------------------------------------ */

export function registerView() {
  const error = errorBox();
  const strength = strengthMeter();
  const password = passwordField('Password', {
    name: 'password', autocomplete: 'new-password', onInput: strength.update,
  });
  const confirm = passwordField('Confirm password', { name: 'confirmPassword', autocomplete: 'new-password' });

  const nameInput = el('input', {
    class: 'input', name: 'name', autocomplete: 'name', required: true,
    dataset: { autofocus: '' }, placeholder: 'Your full name', maxlength: '100',
  });
  const emailInput = el('input', {
    class: 'input', type: 'email', name: 'email', autocomplete: 'email',
    required: true, placeholder: 'you@example.com',
  });
  const terms = el('input', { type: 'checkbox', name: 'acceptedTerms', required: true });
  const submit = el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit', text: 'Create account' });

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const form = el('form', { class: 'auth-form', novalidate: true }, [
    error.node,
    field('Full name', nameInput),
    field('Email', emailInput),
    password.node,
    strength.node,
    confirm.node,
    el('label', { class: 'checkbox' }, [
      terms,
      el('span', { class: 'checkbox-label' }, [
        el('span', { text: 'I agree to the terms of use and understand that everything I write in TELOS is private to my account.' }),
      ]),
    ]),
    submit,
    el('p', { class: 'hint center', text: `Your timezone will be set to ${timezone}. You can change it later.` }),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hide();
    if (password.input.value !== confirm.input.value) {
      error.show('The two passwords do not match.');
      confirm.input.focus();
      return;
    }
    if (!terms.checked) {
      error.show('Please accept the terms to continue.');
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Creating account…';
    try {
      const result = await api.register({
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        password: password.input.value,
        confirmPassword: confirm.input.value,
        acceptedTerms: true,
        timezone,
      });
      setUser(result.user);
      if (result.devVerifyUrl) {
        console.info('[TELOS] Development email verification link:', result.devVerifyUrl);
      }
      navigate('/welcome', { replace: true });
    } catch (err) {
      error.show(err.message);
      submit.disabled = false;
      submit.textContent = 'Create account';
    }
  });

  const card = el('div', { class: 'auth-card' }, [
    el('h1', { text: 'Begin with intention' }),
    el('p', { class: 'muted small', text: 'A private space for the life you are building.' }),
    form,
    el('p', { class: 'auth-alt' }, [
      el('span', { text: 'Already have an account? ' }),
      el('a', { href: '#/login', text: 'Sign in' }),
    ]),
  ]);
  withProviders(form);
  return authFrame(card);
}

/* ------------------------------------------------------------------ *
 * Forgot / reset password
 * ------------------------------------------------------------------ */

export function forgotView() {
  const error = errorBox();
  const done = el('div', { class: 'notice positive', style: { display: 'none' } });
  const emailInput = el('input', {
    class: 'input', type: 'email', required: true, dataset: { autofocus: '' }, placeholder: 'you@example.com',
  });
  const submit = el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit', text: 'Send reset link' });

  const form = el('form', { class: 'auth-form', novalidate: true }, [
    error.node, done, field('Email', emailInput), submit,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hide();
    submit.disabled = true;
    try {
      const result = await api.forgotPassword({ email: emailInput.value.trim() });
      done.textContent = result.message;
      done.style.display = 'block';
      if (result.devResetUrl) {
        console.info('[TELOS] Development reset link:', result.devResetUrl);
        done.append(
          el('p', { class: 'small', style: { marginTop: '8px' } }, [
            el('span', { text: 'Development mode: ' }),
            el('a', { class: 'link', href: result.devResetUrl.slice(result.devResetUrl.indexOf('#')), text: 'open the reset link' }),
          ])
        );
      }
      submit.textContent = 'Sent';
    } catch (err) {
      error.show(err.message);
      submit.disabled = false;
    }
  });

  return authFrame(
    el('div', { class: 'auth-card' }, [
      el('h1', { text: 'Reset your password' }),
      el('p', { class: 'muted small', text: 'We will send a link that expires in 30 minutes.' }),
      form,
      el('p', { class: 'auth-alt' }, [el('a', { href: '#/login', text: 'Back to sign in' })]),
    ])
  );
}

export function resetView({ query }) {
  const token = query.token || '';
  const error = errorBox();
  const strength = strengthMeter();
  const password = passwordField('New password', { name: 'password', autocomplete: 'new-password', onInput: strength.update });
  const confirm = passwordField('Confirm new password', { name: 'confirmPassword', autocomplete: 'new-password' });
  const submit = el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit', text: 'Set new password' });

  const form = el('form', { class: 'auth-form', novalidate: true }, [
    error.node, password.node, strength.node, confirm.node, submit,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hide();
    if (password.input.value !== confirm.input.value) {
      error.show('The two passwords do not match.');
      return;
    }
    submit.disabled = true;
    try {
      const result = await api.resetPassword({
        token,
        password: password.input.value,
        confirmPassword: confirm.input.value,
      });
      toast(result.message);
      navigate('/login', { replace: true });
    } catch (err) {
      error.show(err.message);
      submit.disabled = false;
    }
  });

  if (!token) {
    return authFrame(
      el('div', { class: 'auth-card' }, [
        el('h1', { text: 'Link not valid' }),
        el('p', { class: 'muted small', text: 'This reset link is missing its token. Request a new one.' }),
        el('a', { class: 'btn btn-primary btn-lg btn-block', href: '#/forgot', text: 'Request a new link', style: { marginTop: '24px' } }),
      ])
    );
  }

  return authFrame(
    el('div', { class: 'auth-card' }, [
      el('h1', { text: 'Choose a new password' }),
      el('p', { class: 'muted small', text: 'All other signed-in devices will be signed out.' }),
      form,
    ])
  );
}

export function verifyView({ query }) {
  const status = el('p', { class: 'muted small', text: 'Confirming your email address…' });
  const card = el('div', { class: 'auth-card' }, [
    el('h1', { text: 'Email confirmation' }),
    status,
    el('a', { class: 'btn btn-block', href: '#/', text: 'Continue to TELOS', style: { marginTop: '24px' } }),
  ]);

  api
    .verifyEmail(query.token || '')
    .then((result) => {
      status.textContent = result.message;
      status.className = 'small';
    })
    .catch((err) => {
      status.textContent = err.message;
      status.className = 'small';
    });

  return authFrame(card);
}
