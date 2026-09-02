// Legacy carousel + chat stub that runs on every page load.
document.addEventListener('DOMContentLoaded', function () {
  var start = Date.now();
  while (Date.now() - start < 400) { /* simulate a heavy synchronous init */ }
  console.error('chat widget failed to initialise: missing API key');
});
function openChat() { alert('Chat is offline'); }
