import Image from "next/image";
import styles from "./page.module.css";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "10px 12px",
        background: "white",
      }}
    >
      <span style={{ color: "#334155" }}>{label}</span>
      <code style={{ whiteSpace: "nowrap" }}>{value}</code>
    </div>
  );
}

export default function Home() {
  const baseURL = process.env.NEXT_PUBLIC_BASE_URL ?? "(no definido)";
  const env =
    process.env.VERCEL_ENV ??
    process.env.NEXT_PUBLIC_ENV ??
    process.env.NODE_ENV ??
    "development";
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;

  return (
    <div className={styles.page}>
      <main className={styles.main} style={{ gap: 20, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/ball.svg" alt="Hincha Store" width={40} height={40} />
          <h1 style={{ margin: 0 }}>Hincha Store — API</h1>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#ecfdf5",
            color: "#065f46",
            border: "1px solid #a7f3d0",
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#10b981",
              display: "inline-block",
            }}
          />
          API online
        </div>

        <p style={{ maxWidth: 700, textAlign: "center", color: "#475569" }}>
          Servicio backend de la aplicación <strong>Hincha Store</strong>. Esta
          página confirma que la API está disponible. No se exponen endpoints
          aquí.
        </p>

        <section
          style={{ width: "100%", maxWidth: 640, display: "grid", gap: 12 }}
        >
          <InfoRow label="Base URL" value={baseURL} />
          <InfoRow label="Entorno" value={env} />
          {commit && <InfoRow label="Commit" value={commit} />}
          <InfoRow
            label="Hora del servidor"
            value={new Date().toLocaleString("es-PY")}
          />
        </section>

        <small style={{ color: "#64748b" }}>
          Configurá <code>NEXT_PUBLIC_BASE_URL</code> y (opcional){" "}
          <code>NEXT_PUBLIC_ENV</code> en variables de entorno.
        </small>
      </main>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} Hincha API</span>
        <a
          href="mailto:soporte@tu-dominio.com"
          rel="noopener noreferrer"
          style={{ color: "#0ea5e9" }}
        >
          Soporte
        </a>
      </footer>
    </div>
  );
}
