# No real screenshots obtained

Apple Calendar is desktop/iOS software, not a website, and this session has no
Mac or iPhone to drive directly. The Claude Browser pane was tried against
Apple's own support pages, but every `screenshot` call in this environment
failed with `the Browser pane is not displayed, so the page is not
compositing frames` — a rendering-surface limit of this subagent's sandbox,
not a site problem. Partway through, the same browser pane also started
showing navigation to `registrar.utexas.edu` and
`enterprise.login.utexas.edu` that this session never requested — it is
shared with another concurrent task, so it was abandoned entirely rather than
trusted further.

What this recon actually used instead: the `WebFetch` tool (a direct HTTP
fetch, not the shared browser) against Apple's published support-guide pages,
plus the Claude Browser's `get_page_text` calls made *before* the pane got
cross-contaminated (their content matched the WebFetch results verbatim, so
both are trustworthy). No screenshot image files are checked in here because
none were real — see `docs/import-bar-apple.md` for the exact URLs read and
verbatim quotes in place of pictures.
