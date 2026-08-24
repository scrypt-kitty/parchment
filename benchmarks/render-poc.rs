//! Rust rendering proof of concept: comrak -> syntect -> ammonia.
//!
//! Mirrors what src/render.ts does in the JavaScript pipeline, so the two can
//! be compared on output, speed, and dependency surface.
//!
//! Usage: render-poc <file.md> [iterations]

use std::time::Instant;

use ammonia::Builder;
use comrak::{
    adapters::SyntaxHighlighterAdapter, markdown_to_html_with_plugins, plugins::syntect::SyntectAdapter,
    ComrakOptions, ComrakPlugins,
};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).expect("usage: render-poc <file.md> [iterations]");
    let iterations: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(100);

    let source = std::fs::read_to_string(path).expect("read markdown");

    // Match the JavaScript pipeline's feature set as closely as possible.
    let mut options = ComrakOptions::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.extension.front_matter_delimiter = Some("---".to_owned());
    options.extension.header_ids = Some(String::new()); // GitHub-style slugs
    options.render.unsafe_ = true; // raw HTML kept, then handed to ammonia

    // PARCHMENT_NO_HIGHLIGHT isolates comrak's own parsing cost from syntect's.
    let highlight = std::env::var("PARCHMENT_NO_HIGHLIGHT").is_err();
    let adapter = SyntectAdapter::new(Some("InspiredGitHub"));
    let mut plugins = ComrakPlugins::default();
    if highlight {
        plugins.render.codefence_syntax_highlighter =
            Some(&adapter as &dyn SyntaxHighlighterAdapter);
    }

    // The sanitizer stands where DOMPurify stands in the JS pipeline.
    let mut sanitizer = Builder::default();
    sanitizer
        .add_generic_attributes(["id", "align", "class", "start"])
        .add_tag_attributes("input", ["type", "checked", "disabled"])
        .add_tags(["input", "details", "summary"])
        .url_schemes(
            ["http", "https", "mailto", "tel", "mdasset"]
                .into_iter()
                .collect(),
        )
        .rm_tags(["script", "style", "iframe", "object", "embed", "form"]);

    // Warm up so the first-run syntax-set load does not skew the timing.
    let warm = markdown_to_html_with_plugins(&source, &options, &plugins);
    let warm = sanitizer.clean(&warm).to_string();

    let parse_start = Instant::now();
    for _ in 0..iterations {
        let html = markdown_to_html_with_plugins(&source, &options, &plugins);
        std::hint::black_box(&html);
    }
    let parse = parse_start.elapsed();

    let full_start = Instant::now();
    for _ in 0..iterations {
        let html = markdown_to_html_with_plugins(&source, &options, &plugins);
        let clean = sanitizer.clean(&html).to_string();
        std::hint::black_box(&clean);
    }
    let full = full_start.elapsed();

    eprintln!("input_bytes\t{}", source.len());
    eprintln!("output_bytes\t{}", warm.len());
    eprintln!("iterations\t{iterations}");
    eprintln!(
        "parse_highlight_ms\t{:.3}",
        parse.as_secs_f64() * 1000.0 / f64::from(iterations)
    );
    eprintln!(
        "full_pipeline_ms\t{:.3}",
        full.as_secs_f64() * 1000.0 / f64::from(iterations)
    );

    // stdout carries the HTML so output can be diffed against the JS pipeline.
    println!("{warm}");
}
