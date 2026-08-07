import { importKey, open } from './envelope.js';

/**
 * The browser half of a download.
 *
 * The key arrives in `location.hash`, which the browser did not send when it
 * requested this page. Reading it here is the first moment the key exists on
 * this machine, and it is removed from the address bar immediately afterwards
 * so it does not survive in history, in a screenshot, or in a shared screen.
 */

const button = document.querySelector('#download-button');
const status = document.querySelector('#status');
const uuid = document.body.dataset.uuid;

/**
 * Read the key before doing anything else, then scrub it from the URL.
 *
 * `replaceState` rewrites the current history entry rather than adding one, so
 * the key is gone rather than one Back press away.
 */
const secret = location.hash.slice(1);
history.replaceState(null, '', location.pathname);

if (!secret) {
  setStatus('This link is missing its key. Ask the sender for the complete link.', true);
  button.disabled = true;
}

button.addEventListener('click', async () => {
  button.disabled = true;

  try {
    setStatus('Downloading…');
    const response = await fetch(`/files/download/${uuid}`);
    if (!response.ok) throw new Error('This link has expired or does not exist.');

    const envelope = new Uint8Array(await response.arrayBuffer());

    setStatus('Decrypting in your browser…');
    const key = await importKey(secret);

    // Throws if the key is wrong, the uuid does not match, or the bytes were
    // modified. There is no path here that produces unverified plaintext.
    const file = await open(envelope, uuid, key);

    save(file);
    setStatus(`Saved ${file.name}`);
  } catch (error) {
    setStatus(
      error.name === 'OperationError'
        ? 'Could not decrypt. The link may be incomplete or the file may have been altered.'
        : error.message || 'Download failed.',
      true,
    );
  } finally {
    button.disabled = false;
  }
});

/**
 * Abuse reporting.
 *
 * Sends the uuid and a reason — never the key, which only this page holds.
 * A refusal is almost always the hourly rate limit, so that case gets its own
 * message rather than a generic failure.
 */
document.querySelector('#report-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const reasonField = document.querySelector('#report-reason');
  const reportStatus = document.querySelector('#report-status');

  reportStatus.textContent = 'Sending…';

  try {
    const response = await fetch(`/api/reports/${uuid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reasonField.value }),
    });

    if (response.status === 429) {
      reportStatus.textContent = 'Too many reports from here. Please try again later.';
      return;
    }
    if (!response.ok) throw new Error('Could not send the report.');

    reasonField.value = '';
    reportStatus.textContent = 'Report received. Thank you.';
  } catch (error) {
    reportStatus.textContent = error.message;
  }
});

/**
 * Hands the decrypted bytes to the browser as a download.
 *
 * The anchor is added to the document before being clicked, because some
 * browsers ignore a click on an element that is not in the tree.
 *
 * Revoking the object URL is deferred rather than done straight after the
 * click. `click()` only *starts* the download; revoking synchronously races it
 * and cancels the transfer intermittently. The delay keeps the blob alive long
 * enough for the browser to read it, and the page is short-lived enough that
 * holding it briefly costs nothing.
 *
 * @param {{ name: string, type: string, bytes: Uint8Array }} file
 */
function save({ name, type, bytes }) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';

  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** @param {string} message @param {boolean} [isError] */
function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}
