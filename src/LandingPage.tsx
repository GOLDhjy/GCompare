import appPackage from "../package.json";
import "./App.css";
import "./LandingPage.css";

type DownloadItem = {
  label: string;
  title: string;
  fileName: string;
};

export default function LandingPage() {
  const repoUrl = "https://github.com/GOLDhjy/GCompare";
  const releasesUrl = `${repoUrl}/releases`;
  const latestReleaseUrl = `${repoUrl}/releases/latest`;
  const appVersion = appPackage.version;
  const downloadBaseUrl = `${repoUrl}/releases/download/v${appVersion}`;

  const downloadCards = [
    {
      platform: "Windows",
      subtitle: "System Installer / Portable",
      tone: "windows",
      groups: [
        {
          label: "System Installer",
          items: [
            {
              label: "*-setup.exe",
              title: "Standard installer",
              fileName: `GCompare_${appVersion}_x64-setup.exe`,
            },
          ],
        },
        {
          label: "Portable",
          items: [
            {
              label: "*_en-US.msi",
              title: "Portable MSI bundle",
              fileName: `GCompare_${appVersion}_x64_en-US.msi`,
            },
          ],
        },
      ],
    },
    {
      platform: "macOS (Apple Silicon)",
      subtitle: "DMG / App Tarball",
      tone: "mac",
      groups: [
        {
          label: "App Bundle",
          items: [
            {
              label: "*.app.tar.gz",
              title: "Compressed app bundle",
              fileName: "GCompare_aarch64.app.tar.gz",
            },
          ],
        },
        {
          label: "Installer",
          items: [
            {
              label: "*.dmg",
              title: "Disk image installer",
              fileName: `GCompare_${appVersion}_aarch64.dmg`,
            },
          ],
        },
      ],
    },
    {
      platform: "Linux",
      subtitle: "Deb / RPM / AppImage",
      tone: "linux",
      groups: [
        {
          label: "Ubuntu/Debian",
          items: [
            {
              label: "*.deb",
              title: "Deb package",
              fileName: `GCompare_${appVersion}_amd64.deb`,
            },
          ],
        },
        {
          label: "Fedora/RHEL",
          items: [
            {
              label: "*.rpm",
              title: "RPM package",
              fileName: `GCompare-${appVersion}-1.x86_64.rpm`,
            },
          ],
        },
        {
          label: "Universal",
          items: [
            {
              label: "*.AppImage",
              title: "Portable AppImage",
              fileName: `GCompare_${appVersion}_amd64.AppImage`,
            },
          ],
        },
      ],
    },
  ];

  return (
    <div className="landing-page">
      <header className="landing-header">
        <a href="#" className="landing-logo" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img
            src={`${import.meta.env.BASE_URL}icon256.png`}
            alt="GCompare Logo"
            style={{ width: "32px", height: "32px" }}
          />
          GCompare
        </a>
        <nav className="landing-nav">
          <a href="#download">Download</a>
          <a href="#features">Features</a>
          <a href={repoUrl} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <main>
        <section className="hero-section">
          <h1 className="hero-title">
            GCompare - Modern File Comparison
            <br />
            for Everyone
          </h1>
          <p className="hero-subtitle">
            GCompare is a <span className="highlight">fast</span>, <span className="highlight">clean</span>, and{" "}
            <span className="highlight">cross-platform</span> diff tool built with Tauri and React. Compare{" "}
            <span className="highlight">text</span>, <span className="highlight">files</span>, and{" "}
            <span className="highlight">Git/P4/SVN history</span> with ease.
          </p>
          <div className="cta-group">
            <a href={latestReleaseUrl} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
              Download Latest Release
            </a>
            <a href={releasesUrl} className="btn btn-secondary" target="_blank" rel="noopener noreferrer">
              View All Releases
            </a>
          </div>
        </section>

        <section id="download" className="download-section">
          <div className="download-header">
            <div>
              <p className="download-kicker">Download</p>
              <h2 className="download-title">Choose your platform</h2>
            </div>
            <p className="download-subtitle">Direct links for release v{appVersion}.</p>
          </div>
          <div className="download-grid">
            {downloadCards.map((card, index) => (
              <article
                className={`download-card ${card.tone}`}
                key={card.platform}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="download-card-header">
                  <div className={`platform-mark ${card.tone}`} aria-hidden="true">
                    {card.platform.slice(0, 1)}
                  </div>
                  <div>
                    <h3 className="download-platform">{card.platform}</h3>
                    <p className="download-platform-subtitle">{card.subtitle}</p>
                  </div>
                </div>
                <div className="download-groups">
                  {card.groups.map((group) => (
                    <div className="download-group" key={group.label}>
                      <span className="download-group-title">{group.label}</span>
                      <div className="download-options">
                        {group.items.map((item: DownloadItem) => (
                          <a
                            className="download-chip"
                            href={`${downloadBaseUrl}/${item.fileName}`}
                            title={`${item.title} (direct download)`}
                            key={item.fileName}
                            target="_blank"
                            rel="noopener noreferrer"
                            download=""
                          >
                            {item.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <div className="download-footer">
            <span className="download-note">Need a different build?</span>
            <a href={releasesUrl} target="_blank" rel="noopener noreferrer">
              Browse all release assets on GitHub.
            </a>
          </div>
        </section>

        <section className="preview-section">
          <div className="preview-placeholder">
            {/* You can replace this with an actual screenshot <img> tag */}
            <img
              src={`${import.meta.env.BASE_URL}Images/v0.2.0.png`}
              alt="GCompare Screenshot"
              style={{ width: "100%", height: "auto", borderRadius: "8px", display: "block" }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement!.innerText = "App Screenshot";
              }}
            />
          </div>
        </section>

        <section id="features" className="features-grid">
          <div className="feature-card">
            <span className="feature-icon">FAST</span>
            <h3 className="feature-title">Lightning Fast</h3>
            <p className="feature-desc">
              Built with Rust and Tauri for native performance and small bundle size. Starts instantly.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">CLEAN</span>
            <h3 className="feature-title">Clean Interface</h3>
            <p className="feature-desc">
              Minimalist design focused on what matters: your code changes. Powered by Monaco Editor.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">SAFE</span>
            <h3 className="feature-title">Privacy First</h3>
            <p className="feature-desc">
              Runs entirely offline. Your files never leave your computer. Open source and transparent.
            </p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>(c) {new Date().getFullYear()} GCompare. Released under MIT License.</p>
      </footer>
    </div>
  );
}
