import './App.css';
import './LandingPage.css';

export default function LandingPage() {
  const repoUrl = "https://github.com/GOLDhjy/GCompare";
  const downloadUrl = `${repoUrl}/releases`;

  return (
    <div className="landing-page">
      <header className="landing-header">
        <a href="#" className="landing-logo">GCompare</a>
        <nav className="landing-nav">
          <a href="#features">Features</a>
          <a href={repoUrl} target="_blank" rel="noopener noreferrer">GitHub</a>
        </nav>
      </header>

      <main>
        <section className="hero-section">
          <h1 className="hero-title">
            Modern File Comparison<br />
            for Developers
          </h1>
          <p className="hero-subtitle">
            A fast, clean, and cross-platform diff tool built with Tauri and React.
            Compare text, files, and git history with ease.
          </p>
          <div className="cta-group">
            <a href={downloadUrl} className="btn btn-primary">
              Download for macOS
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
              src="/Images/v0.1.0.png" 
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
