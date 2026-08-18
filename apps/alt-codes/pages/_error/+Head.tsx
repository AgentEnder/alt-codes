export function Head() {
  return (
    <>
      {/* Nothing here should ever be indexed, whichever status it carries. */}
      <meta name="robots" content="noindex" />
    </>
  );
}
