// Turns a project's markdown description into safe HTML.
// Raw HTML typed into the description is shown as plain text (html: false), and
// markdown-it refuses javascript: / vbscript: / data: links, so a description can
// never run code on the site. Used by the admin preview and the product page.
// Needs vendor/markdown-it.min.js to be loaded first.

var _cdMarkdown = null;

function renderMarkdown(source) {
  if (!_cdMarkdown) {
    _cdMarkdown = window.markdownit({ html: false, linkify: true, breaks: true, typographer: false });

    // Links open in a new tab and do not pass on referrer information.
    var defaultLink = _cdMarkdown.renderer.rules.link_open ||
      function (tokens, idx, options, env, self) { return self.renderToken(tokens, idx, options); };
    _cdMarkdown.renderer.rules.link_open = function (tokens, idx, options, env, self) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer nofollow');
      return defaultLink(tokens, idx, options, env, self);
    };
  }
  return _cdMarkdown.render(String(source || ''));
}
