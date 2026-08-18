import { usePageContext } from 'vike-react/usePageContext';
import { withBase } from '../../src/utils';
import { SearchInput } from '../../src/SearchInput';
import '../../src/style.css';

/**
 * Vike's error page.
 *
 * New with the Worker, and not cosmetic. While the app was prerendered, an
 * unknown URL was the static host's problem — GitHub Pages answered it from
 * `public/404.html` and the app never saw the request. On a Worker every URL
 * reaches Vike, and with no error page defined Vike answers a bare
 * "An error occurred." with a 500. A crawler reads a 500 as "retry later, keep
 * the URL indexed" and a 404 as "drop it", so the missing page was quietly
 * turning every dead link into a permanently indexed one.
 */
export default function Page() {
  const { is404 } = usePageContext();

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-inner">
          <a href={withBase('/')} className="header-brand" style={{ textDecoration: 'none' }}>
            <div className="brand-title">Glyph Index</div>
            <div className="brand-sub">Unicode &amp; Alt Code Reference</div>
          </a>
          <div className="header-search">
            <SearchInput />
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="empty-state">
          {is404 ? (
            <>
              <p className="empty-title">
                <strong>404</strong> — no glyph at this address.
              </p>
              <p className="empty-hint">
                Search above, or <a href={withBase('/')} className="breadcrumb-link">browse all glyphs</a>.
              </p>
            </>
          ) : (
            <>
              <p className="empty-title">
                <strong>500</strong> — something went wrong rendering this page.
              </p>
              <p className="empty-hint">
                Try again, or <a href={withBase('/')} className="breadcrumb-link">start from the index</a>.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
