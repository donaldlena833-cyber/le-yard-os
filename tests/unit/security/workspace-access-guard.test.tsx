// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), replace: vi.fn(), unsubscribe: vi.fn(), handler: null as null | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: (handler: typeof mocks.handler) => { mocks.handler = handler;return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
vi.mock("@/lib/auth/workspace-access.client", () => ({ replaceWorkspaceDocument: mocks.replace, WORKSPACE_ACCESS_NOTICE_KEY: "notice" }));
import { WorkspaceAccessGuard, WORKSPACE_ACCESS_POLL_MS, WORKSPACE_ACCESS_TIMEOUT_MS } from "@/components/providers/workspace-access-guard";
const revision = "a".repeat(64);
let online = true;let hidden = false;
const ready = () => Response.json({ status: "ready", revision });
function screenWithScope(value: string | null = revision) { return <WorkspaceAccessGuard revision={value} userId="user" homePath="/today"><input aria-label="Private draft" defaultValue="" /><button>Protected save</button></WorkspaceAccessGuard>; }
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(1); });
beforeEach(() => { vi.useFakeTimers();vi.clearAllMocks();online = true;hidden = false;mocks.handler = null;vi.spyOn(navigator,"onLine","get").mockImplementation(() => online);vi.spyOn(document,"hidden","get").mockImplementation(() => hidden);mocks.fetch.mockImplementation(async () => ready());vi.stubGlobal("fetch",mocks.fetch); });
afterEach(() => { cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers(); });
describe("workspace context withdrawal", () => {
  it("covers the initial screen until an authoritative matching response arrives", async () => {
    let answer!: (r: Response) => void;mocks.fetch.mockImplementation(() => new Promise<Response>(resolve => { answer = resolve; }));render(screenWithScope());
    expect(screen.queryByRole("button",{name:"Protected save"})).toBeNull();
    await act(async () => { answer(ready()); });expect(screen.getByRole("button",{name:"Protected save"})).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledWith("/api/workspace/access",expect.objectContaining({ cache:"no-store",credentials:"same-origin",redirect:"error" }));
  });
  it("preserves an authorized draft through a covered focus recheck", async () => {
    render(screenWithScope());await flush();const input=screen.getByLabelText("Private draft") as HTMLInputElement;fireEvent.change(input,{target:{value:"Unsubmitted text"}});
    fireEvent(window,new Event("focus"));expect(screen.queryByRole("button",{name:"Protected save"})).toBeNull();await flush();expect((screen.getByLabelText("Private draft") as HTMLInputElement).value).toBe("Unsubmitted text");
  });
  it("retires the old component tree once when current scope changes", async () => {
    render(screenWithScope());await flush();mocks.fetch.mockResolvedValue(Response.json({status:"ready",revision:"b".repeat(64)}));
    await act(async () => { await vi.advanceTimersByTimeAsync(WORKSPACE_ACCESS_POLL_MS); });
    expect(screen.queryByLabelText("Private draft")).toBeNull();expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/today");fireEvent(window,new Event("focus"));await flush();expect(mocks.replace).toHaveBeenCalledTimes(1);
  });
  it.each([[401,"/sign-in"],[403,"/today"]])("withdraws the tree on HTTP%s",async(status,path)=>{
    render(screenWithScope());await flush();mocks.fetch.mockResolvedValue(new Response(null,{status}));fireEvent(window,new Event("focus"));await flush();expect(screen.queryByLabelText("Private draft")).toBeNull();expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(path);
  });
  it("covers an offline screen and ignores an older in-flight success",async()=>{
    render(screenWithScope());await flush();let old!: (r:Response)=>void;mocks.fetch.mockImplementationOnce(()=>new Promise<Response>(resolve=>{old=resolve;}));fireEvent(window,new Event("focus"));online=false;fireEvent(window,new Event("offline"));await act(async()=>old(ready()));expect(screen.queryByRole("button",{name:"Protected save"})).toBeNull();expect(mocks.replace).not.toHaveBeenCalled();online=true;fireEvent(window,new Event("online"));await flush();expect(screen.getByRole("button",{name:"Protected save"})).toBeTruthy();
  });
  it("covers failed checks and recovers only after another matching response",async()=>{
    render(screenWithScope());await flush();mocks.fetch.mockRejectedValueOnce(Error("offline"));fireEvent(window,new Event("focus"));await flush();expect(screen.queryByRole("button",{name:"Protected save"})).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Try again"}));await flush();expect(screen.getByRole("button",{name:"Protected save"})).toBeTruthy();expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("times out a stalled request and refuses malformed success bodies",async()=>{
    mocks.fetch.mockImplementationOnce(()=>new Promise(()=>{}));render(screenWithScope());await act(async()=>{await vi.advanceTimersByTimeAsync(WORKSPACE_ACCESS_TIMEOUT_MS);});expect(screen.getByRole("button",{name:"Try again"})).toBeTruthy();mocks.fetch.mockResolvedValueOnce(Response.json({status:"ready",revision:"invalid"}));fireEvent.click(screen.getByRole("button",{name:"Try again"}));await flush();expect(screen.queryByRole("button",{name:"Protected save"})).toBeNull();expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("does not poll a hidden tab and verifies before displaying it again",async()=>{
    render(screenWithScope());await flush();hidden=true;fireEvent(document,new Event("visibilitychange"));const count=mocks.fetch.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(WORKSPACE_ACCESS_POLL_MS*2);});expect(mocks.fetch).toHaveBeenCalledTimes(count);hidden=false;fireEvent(document,new Event("visibilitychange"));await flush();expect(mocks.fetch).toHaveBeenCalledTimes(count+1);expect(screen.getByRole("button",{name:"Protected save"})).toBeTruthy();
  });
  it.each(["SIGNED_OUT","OTHER_USER"])("withdraws immediately on Auth%s without waiting for the poll",async(event)=>{
    render(screenWithScope());await flush();act(()=>mocks.handler!(event === "OTHER_USER"?"SIGNED_IN":event,event === "OTHER_USER"?{user:{id:"someone-else"}}:null));expect(screen.queryByLabelText("Private draft")).toBeNull();expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/sign-in");
  });
  it("revalidates changed server props without exposing the old tree",async()=>{
    const view=render(screenWithScope());await flush();view.rerender(screenWithScope("b".repeat(64)));expect(screen.queryByRole("button",{name:"Protected save"})).toBeNull();await flush();expect(mocks.replace).toHaveBeenCalledWith("/today");
  });
  it("cleans up listeners and leaves demo mode free of live polling",async()=>{
    const view=render(screenWithScope());await flush();view.unmount();expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);const count=mocks.fetch.mock.calls.length;fireEvent(window,new Event("focus"));await flush();expect(mocks.fetch).toHaveBeenCalledTimes(count);render(screenWithScope(null));expect(screen.getByRole("button",{name:"Protected save"})).toBeTruthy();expect(mocks.fetch).toHaveBeenCalledTimes(count);
  });
});
