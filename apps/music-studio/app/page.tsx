import { RecentProjects } from "./RecentProjects";
import styles from "./home.module.css";

export default function HomePage() {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Synaptix Music home">
          <span className="studio-mark" aria-hidden="true">
            S
          </span>
          <span>
            Synaptix <span className={styles.muted}>Music</span>
          </span>
        </a>
        <nav className={styles.navigation} aria-label="Main navigation">
          <a href="#projects">Your projects</a>
          <a className={styles.headerCta} href="/studio/local-demo">
            Open studio <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>

      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="welcome-heading">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Your sound. Your workspace.</p>
            <h1 id="welcome-heading">
              Make room
              <br />
              for your next <em>idea.</em>
            </h1>
            <p className={styles.lede}>
              Build a beat, shape a melody, and find your sound. Your music studio is right here in
              the browser.
            </p>
            <a className={styles.primaryLink} href="/studio/local-demo">
              Open demo studio <span aria-hidden="true">→</span>
            </a>
            <p className={styles.heroNote}>
              No account needed for local editing. Press Play to hear the demo.
            </p>
          </div>
          <div className={styles.preview} aria-hidden="true">
            <div className={styles.previewHeader}>
              <span className={styles.previewDot} /> THE STARTING POINT <span>120 BPM</span>
            </div>
            <div className={styles.previewRuler}>
              <span>01</span>
              <span>05</span>
              <span>09</span>
              <span>13</span>
            </div>
            {["Drums", "Bass", "Harmony", "Melody"].map((track, index) => (
              <div className={styles.previewTrack} key={track}>
                <span>{track}</span>
                <div className={`${styles.clip} ${styles[`track${index}`]}`}>
                  {Array.from({ length: 16 }, (_, step) => (
                    <i key={step} style={{ height: `${20 + ((step * 7 + index * 11) % 65)}%` }} />
                  ))}
                </div>
              </div>
            ))}
            <div className={styles.previewFooter}>
              <span>4 tracks. Endless possibilities.</span>
              <span>● ● ●</span>
            </div>
          </div>
        </section>

        <section id="projects" className={styles.projects} aria-labelledby="projects-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Pick up where you left off</p>
              <h2 id="projects-heading">Your projects</h2>
            </div>
            <span className={styles.localBadge}>Saved in this browser</span>
          </div>
          <RecentProjects />
          <p className={styles.storageNote}>
            Local projects stay in this browser on this device. Clearing site data removes them.
          </p>
        </section>

        <section className={styles.workflow} aria-labelledby="workflow-heading">
          <div>
            <p className={styles.eyebrow}>From a first note to a full arrangement</p>
            <h2 id="workflow-heading">A place for every part of your sound.</h2>
          </div>
          <div className={styles.workflowGrid}>
            <article>
              <span>01 / ARRANGE</span>
              <h3>See the whole idea.</h3>
              <p>Bring drums, bass, chords, and melody together on one timeline.</p>
            </article>
            <article>
              <span>02 / EDIT</span>
              <h3>Make every note yours.</h3>
              <p>
                Open a clip to shape its notes in the piano roll or build a rhythm in the drum
                sequencer.
              </p>
            </article>
            <article>
              <span>03 / LISTEN</span>
              <h3>Find the right balance.</h3>
              <p>
                Play, loop, and adjust track levels and instrument settings as your arrangement
                takes shape.
              </p>
            </article>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>Synaptix Music · A space to create.</span>
        <span>Local editing works without the SynaptixPlay platform.</span>
      </footer>
    </div>
  );
}
