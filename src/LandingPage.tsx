import './App.css';
import './LandingPage.css';

export default function LandingPage() {
  const repoUrl = "https://github.com/GOLDhjy/GCompare";
  const downloadUrl = `${repoUrl}/releases`;

  return (
    <div className="landing-page">
      <header className="landing-header">
        <a href="#" className="landing-logo" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src={`${import.meta.env.BASE_URL}icon256.png`} alt="GCompare Logo" style={{ width: '32px', height: '32px' }} />
          GCompare
        </a>
        <nav className="landing-nav">
          <a href="#features">Features</a>
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer">Download</a>
          <a href={repoUrl} target="_blank" rel="noopener noreferrer">GitHub</a>
        </nav>
      </header>

      <main>
        <section className="hero-section">
          <h1 className="hero-title">
            GCompare — Modern File Comparison<br />
            for Everyone
          </h1>
          <p className="hero-subtitle">
            GCompare is a <span className="highlight">fast</span>, <span className="highlight">clean</span>, and <span className="highlight">cross-platform</span> diff tool built with Tauri and React.
            Compare <span className="highlight">text</span>, <span className="highlight">files</span>, and <span className="highlight">Git/P4/SVN history</span> with ease.
          </p>
          <div className="cta-group">
            <a href={downloadUrl} className="btn btn-primary">
              Download Latest Release
            </a>
            <a href={repoUrl} className="btn btn-secondary" target="_blank" rel="noopener noreferrer">
              View Source
            </a>
          </div>
        </section>

        <section className="preview-section">
          <div className="preview-placeholder">
            {/* You can replace this with an actual screenshot <img> tag */}
            <img 
              src={`${import.meta.env.BASE_URL}Images/v0.2.0.png`}
              alt="GCompare Screenshot" 
              style={{width: '100%', height: 'auto', borderRadius: '8px', display: 'block'}}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement!.innerText = 'App Screenshot';
              }}
            />
          </div>
        </section>

        <section id="features" className="features-grid">
          <div className="feature-card">
            <span className="feature-icon">⚡️</span>
            <h3 className="feature-title">Lightning Fast</h3>
            <p className="feature-desc">
              Built with Rust and Tauri for native performance and small bundle size.
              Starts instantly.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">🎨</span>
            <h3 className="feature-title">Clean Interface</h3>
            <p className="feature-desc">
              Minimalist design focused on what matters: your code changes.
              Powered by Monaco Editor.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">🛡️</span>
            <h3 className="feature-title">Privacy First</h3>
            <p className="feature-desc">
              Runs entirely offline. Your files never leave your computer.
              Open source and transparent.
            </p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>© {new Date().getFullYear()} GCompare. Released under MIT License.</p>
      </footer>
    </div>
  );
}
