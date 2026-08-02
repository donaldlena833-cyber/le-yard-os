export default function WorkspaceLoading() {
  return (
    <div className="mx-auto w-full max-w-[1520px] animate-pulse px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8" aria-label="Loading workspace" role="status">
      <div className="h-40 rounded-[26px] bg-[var(--canvas-strong)]" />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 rounded-[16px] bg-[var(--canvas-strong)]" />)}
      </div>
      <div className="mt-8 grid gap-5 lg:grid-cols-[1.4fr_.6fr]">
        <div className="h-80 rounded-[22px] bg-[var(--canvas-strong)]" />
        <div className="h-80 rounded-[22px] bg-[var(--canvas-strong)]" />
      </div>
      <span className="sr-only">Loading Le Yard OS</span>
    </div>
  );
}
