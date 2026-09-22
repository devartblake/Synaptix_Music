"use client";

import { useEffect, useState } from "react";
import { IndexedDbProjectStorage, type StoredProjectSummary } from "@synaptix/project-storage";
import styles from "./home.module.css";

export function RecentProjects() {
  const [projects, setProjects] = useState<StoredProjectSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      try {
        const saved = await new IndexedDbProjectStorage().listProjects();
        if (!cancelled) {
          setProjects(saved);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (status === "loading")
    return (
      <p className={styles.projectMessage} role="status">
        Loading your local projects…
      </p>
    );
  if (status === "error")
    return (
      <div className={styles.projectMessage} role="status">
        <p>
          Your saved projects couldn’t be read. Check that browser storage is available, then try
          again.
        </p>
        <button onClick={() => setAttempt((value) => value + 1)}>Retry loading projects</button>
      </div>
    );
  if (projects.length === 0)
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon} aria-hidden="true">
          ♫
        </span>
        <div>
          <h3>Your first session starts here.</h3>
          <p>
            Open the demo and make an edit. Your saved projects will appear here when you return.
          </p>
        </div>
        <a className={styles.textLink} href="/studio/local-demo">
          Explore the demo <span aria-hidden="true">→</span>
        </a>
      </div>
    );

  return (
    <ul className={styles.projectGrid}>
      {projects.map((project) => (
        <li key={project.projectId}>
          <a
            className={styles.projectCard}
            href={`/studio/${encodeURIComponent(project.projectId)}`}
          >
            <span className={styles.projectCardTop}>
              <span className={styles.projectIcon} aria-hidden="true">
                ♫
              </span>
              <span aria-hidden="true">↗</span>
            </span>
            <h3>{project.name}</h3>
            <p>
              Edited{" "}
              <time dateTime={project.updatedAt}>
                {new Date(project.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric"
                })}
              </time>
            </p>
            <span className={styles.textLink}>
              Continue project <span aria-hidden="true">→</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
