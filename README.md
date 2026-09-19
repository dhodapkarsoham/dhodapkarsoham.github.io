# Soham’s notebook

A personal blog about graphs, data, AI, and life, published at https://dhodapkarsoham.github.io.

## Preview locally

Use Ruby 3.3 and Bundler (the macOS system Ruby is too old).

```sh
bundle install
bundle exec jekyll serve
```

Visit http://localhost:4000. Production builds use `bundle exec jekyll build`.
The Jekyll 3.10 series matches GitHub Pages’ native build environment. No Node.js build or external font service is required.

## Publish a post

Create `_posts/YYYY-MM-DD-your-title.md`:

```yaml
---
layout: post
title: "Your title"
description: "A short introduction for the homepage and search previews."
tags: [Personal]
---
```

Write Markdown below the front matter. Technical and personal posts share the same feed; tags are generated automatically. Use descriptive image alt text and `{{ '/assets/img/example.png' | relative_url }}` for image paths. Set `archived: true` to show the historical-context note on an older tutorial.

The homepage shows all published posts. Search includes local posts and the linked Neo4j articles, filtering titles, descriptions, and topics in the browser; browsing and reading still work without JavaScript. RSS is available at `/feed.xml` and topics at `/tags`. Existing dated post URLs are preserved.

## Appearance

The header provides System, Light, and Dark options. System follows device preferences, including live changes. An explicit choice is saved locally and applied before the page paints. All pages share the theme, including code blocks. With JavaScript disabled, the site follows the device color scheme.

External articles are maintained in `_data/external_posts.yml` and appear on the homepage and About page. Their links lead to the original publication; they are not republished in the RSS feed.

## Design and configuration

- `_layouts/`: homepage, article, and page templates.
- `assets/css/notebook.css`: responsive design and reading styles.
- `assets/js/notebook.js`: progressively enhanced post search.
- `_config.yml`: site identity, canonical URL, and existing analytics settings.
- `aboutme.md`: author biography.

The original Beautiful Jekyll theme files and MIT attribution remain in the repository for reference; active pages use the custom notebook layouts. Bootstrap, jQuery, and remote fonts are no longer loaded by the active layout. The existing Google Tag Manager integration is retained.

## Deployment

Continue using the repository’s existing GitHub Pages source branch and root directory. The CI workflow checks builds on pushes and pull requests; it does not change deployment settings. Review changes on a branch before merging into the branch GitHub Pages publishes.

## Validation

```sh
bundle exec jekyll build
python3 scripts/check_site.py
node scripts/check_appearance.cjs
```

The check validates internal links and images, RSS XML, the original post URL, and the main pages.
