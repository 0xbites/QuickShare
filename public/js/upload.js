import { generateKey, exportKey, seal } from './envelope.js';

/**
 * The browser half of an upload.
 *
 * Order matters and is dictated by the cryptography:
 *
 *   1. ask the server for a uuid   — it is an input to encryption
 *   2. generate a key              — never leaves this page
 *   3. seal the file               — filename and type go inside the ciphertext
 *   4. PUT the envelope            — the server receives opaque bytes
 *   5. build the link here         — so the key never reaches the server
 *
 * Step 5 is the one that is easy to get wrong. If the server built the link it
 * would need the key, and the whole property would collapse.
 */

const form = document.querySelector('#upload-form');
const input = document.querySelector('#file-input');
const submit = document.querySelector('#submit-button');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const linkOutput = document.querySelector('#share-link');
const copyButton = document.querySelector('#copy-button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = input.files[0];
  if (!file) {
    setStatus('Choose a file first.', true);
    return;
  }

  setBusy(true);

  try {
    setStatus('Reserving a link…');
    const { uuid } = await postJson('/api/files/allocate');

    setStatus('Encrypting in your browser…');
    const key = await generateKey();
    const envelope = await seal(file, uuid, key);

    setStatus('Uploading…');
    const response = await fetch(`/api/files/${uuid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: envelope,
    });
    if (!response.ok) throw new Error(await readError(response));

    // The key goes after the '#', which browsers never transmit.
    const shareLink = `${location.origin}/files/${uuid}#${await exportKey(key)}`;

    linkOutput.value = shareLink;
    result.hidden = false;
    form.hidden = true;
    setStatus('');
  } catch (error) {
    setStatus(error.message || 'Upload failed.', true);
  } finally {
    setBusy(false);
  }
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(linkOutput.value);
  copyButton.textContent = 'Copied';
  setTimeout(() => {
    copyButton.textContent = 'Copy';
  }, 1500);
});

/**
 * @param {string} url
 * @returns {Promise<object>}
 */
async function postJson(url) {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

/**
 * Prefers the server's message, but never lets a parse failure mask the real
 * problem, which is that the request failed.
 *
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readError(response) {
  try {
    const body = await response.json();
    return body.error || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

/** @param {string} message @param {boolean} [isError] */
function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

/** @param {boolean} busy */
function setBusy(busy) {
  submit.disabled = busy;
  input.disabled = busy;
}
