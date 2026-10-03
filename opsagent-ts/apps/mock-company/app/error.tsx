"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <h1>Temporary service failure</h1>
      <p>
        The company system could not serve this page. Your submitted data has
        not been confirmed.
      </p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
