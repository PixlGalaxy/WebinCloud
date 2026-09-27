interface Props {
  html: string;
  title: string;
}

/**
 * Runs the page for real, inside an iframe with no origin of its own: scripts
 * execute (so the page behaves as intended), but with no `allow-same-origin`
 * the frame gets a unique opaque origin, so it can never read this app's
 * cookies or session, reach its API, or navigate the parent window — the same
 * isolation CodePen/JSFiddle previews rely on for arbitrary HTML.
 */
const HtmlPreview = ({ html, title }: Props) => (
  <iframe
    srcDoc={html}
    title={title}
    sandbox="allow-scripts"
    className="h-full w-full border-0 bg-white"
  />
);

export default HtmlPreview;
