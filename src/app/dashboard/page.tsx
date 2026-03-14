"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import Loader from "@/components/Loader";

const API =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:8000`
    : "http://localhost:8000";
const WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:8000/ws`
    : "ws://localhost:8000/ws";

interface Friend {
  id: string;
  uid: string;
  username: string;
  avatar_color: string;
  is_online: boolean;
  last_seen: string | null;
}

interface Msg {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  reply_to_id: string | null;
  reply_preview: string | null;
  status: string;
  is_deleted: boolean;
  created_at: string;
}

interface FriendReq {
  id: string;
  sender_id: string;
  sender_username: string;
  sender_uid: string;
  status: string;
}

export default function DashboardPage() {
  const { user, token, logout, loading } = useAuth();
  const router = useRouter();

  // ── State ──
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendReq[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [searchUid, setSearchUid] = useState("");
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searchError, setSearchError] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [tab, setTab] = useState<"chats" | "requests" | "search">("chats");
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: Msg } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // ── Fetch friends + requests ──
  const fetchFriends = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API}/api/friends`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setFriends(await res.json());
  }, [token]);

  const fetchRequests = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API}/api/friends/requests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setFriendRequests(await res.json());
  }, [token]);

  useEffect(() => {
    fetchFriends();
    fetchRequests();
  }, [fetchFriends, fetchRequests]);

  // ── Fetch messages for selected friend ──
  const fetchMessages = useCallback(async (friendId: string) => {
    if (!token) return;
    const res = await fetch(`${API}/api/messages/${friendId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setMessages(await res.json());
  }, [token]);

  useEffect(() => {
    if (selectedFriend) fetchMessages(selectedFriend.id);
  }, [selectedFriend, fetchMessages]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── WebSocket ──
  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "message") {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev;
          return [...prev, data];
        });
      } else if (data.type === "typing") {
        if (data.is_typing) {
          setTypingUsers((prev) => new Set(prev).add(data.user_id));
          setTimeout(() => {
            setTypingUsers((prev) => {
              const next = new Set(prev);
              next.delete(data.user_id);
              return next;
            });
          }, 3000);
        } else {
          setTypingUsers((prev) => {
            const next = new Set(prev);
            next.delete(data.user_id);
            return next;
          });
        }
      } else if (data.type === "messages_read") {
        setMessages((prev) =>
          prev.map((m) =>
            m.sender_id === user?.id && m.receiver_id === data.by
              ? { ...m, status: "read" }
              : m
          )
        );
      } else if (data.type === "message_deleted") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.message_id
              ? { ...m, is_deleted: true, content: null, file_url: null }
              : m
          )
        );
      } else if (data.type === "presence") {
        setFriends((prev) =>
          prev.map((f) =>
            f.id === data.user_id ? { ...f, is_online: data.is_online } : f
          )
        );
      } else if (data.type === "friend_request") {
        fetchRequests();
      } else if (data.type === "request_accepted") {
        fetchFriends();
      }

    };

    return () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id]);

  // ── Send message ──
  const sendMessage = () => {
    if (!input.trim() && !replyTo) return;
    if (!selectedFriend || !wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({
        type: "message",
        to: selectedFriend.id,
        content: input.trim(),
        reply_to_id: replyTo?.id || null,
      })
    );
    setInput("");
    setReplyTo(null);
    setShowEmojiPicker(false);
  };

  // ── Typing indicator ──
  const handleInputChange = (val: string) => {
    setInput(val);
    if (!selectedFriend || !wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({ type: "typing", to: selectedFriend.id, is_typing: true })
    );
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      wsRef.current?.send(
        JSON.stringify({ type: "typing", to: selectedFriend.id, is_typing: false })
      );
    }, 2000);
  };

  // ── Mark as read ──
  const markRead = (friendId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "read", from: friendId }));
  };

  // ── Delete message ──
  const deleteMessage = (msgId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "delete", message_id: msgId }));
    setContextMenu(null);
  };

  // ── File upload ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedFriend || !token) return;
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (res.ok) {
      const data = await res.json();
      wsRef.current?.send(
        JSON.stringify({
          type: "message",
          to: selectedFriend.id,
          content: "",
          file_url: data.file_url,
          file_name: data.file_name,
          file_type: data.file_type,
        })
      );
    }
    e.target.value = "";
  };

  // ── Search user ──
  const handleSearch = async () => {
    if (!searchUid.trim() || !token) return;
    setSearchError("");
    setSearchResult(null);
    try {
      const res = await fetch(`${API}/api/users/search?uid=${searchUid.trim()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSearchResult(await res.json());
      else setSearchError("User not found");
    } catch {
      setSearchError("Search failed");
    }
  };

  const sendFriendRequest = async (uid: string) => {
    if (!token) return;
    const res = await fetch(`${API}/api/friends/request?receiver_uid=${uid}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setSearchResult(null);
      setSearchUid("");
      alert("Friend request sent!");
    } else {
      const data = await res.json();
      alert(data.detail || "Failed to send request");
    }
  };

  const acceptRequest = async (requestId: string) => {
    if (!token) return;
    await fetch(`${API}/api/friends/accept/${requestId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchRequests();
    fetchFriends();
  };

  const declineRequest = async (requestId: string) => {
    if (!token) return;
    await fetch(`${API}/api/friends/decline/${requestId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchRequests();
  };



  // ── Emoji list ──
  const EMOJIS = ["😀","😂","😍","🥰","😎","🤩","😢","😡","👍","👎","❤️","🔥","🎉","💯","🙏","👋","✨","💬","📎","🎵"];

  // ── Format time ──
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatLastSeen = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const statusIcon = (status: string) => {
    if (status === "read") return "✓✓";
    if (status === "delivered") return "✓✓";
    if (status === "sent") return "✓";
    return "";
  };

  const statusColor = (status: string) => {
    if (status === "read") return "#3b82f6";
    return "#8888a0";
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center flex-col gap-4">
        <Loader size="lg" className="text-[var(--accent)]" />
        <p className="text-[var(--text-secondary)] animate-pulse">Loading ChatConnect...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" onClick={() => setContextMenu(null)}>
      {/* ═══ SIDEBAR ═══ */}
      <div
        className={`${
          showSidebar ? "w-80" : "w-0"
        } flex flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)] transition-all duration-300 overflow-hidden flex-shrink-0`}
      >
        {/* User header */}
        <div className="flex items-center gap-3 border-b border-[var(--border)] p-4">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-white font-bold text-sm flex-shrink-0"
            style={{ background: user.avatar_color || "#6c63ff" }}
          >
            {user.username[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{user.username}</p>
            <p className="text-xs text-[var(--text-secondary)] font-mono">ID: {user.uid}</p>
          </div>
          <button
            onClick={logout}
            className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-red-400 transition-colors"
            title="Logout"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          {(["chats", "requests", "search"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${
                tab === t
                  ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t === "requests" ? `Requests${friendRequests.length ? ` (${friendRequests.length})` : ""}` : t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Friends list ── */}
          {tab === "chats" && (
            <div>
              {friends.length === 0 && (
                <div className="p-6 text-center text-sm text-[var(--text-secondary)]">
                  <p className="mb-2">No friends yet</p>
                  <p className="text-xs">Search by User ID to add friends</p>
                </div>
              )}
              {friends.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setSelectedFriend(f);
                    markRead(f.id);
                    if (window.innerWidth < 768) setShowSidebar(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-3 transition-colors ${
                    selectedFriend?.id === f.id
                      ? "bg-[var(--accent-soft)]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-full text-white font-bold text-sm"
                      style={{ background: f.avatar_color }}
                    >
                      {f.username[0]?.toUpperCase()}
                    </div>
                    {f.is_online && (
                      <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-[var(--success)] border-2 border-[var(--bg-secondary)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-medium text-sm truncate">{f.username}</p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {f.is_online ? (
                        <span className="text-[var(--success)]">Online</span>
                      ) : (
                        `Last seen ${formatLastSeen(f.last_seen)}`
                      )}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ── Requests ── */}
          {tab === "requests" && (
            <div>
              {friendRequests.length === 0 && (
                <div className="p-6 text-center text-sm text-[var(--text-secondary)]">No pending requests</div>
              )}
              {friendRequests.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-white font-bold text-sm flex-shrink-0">
                    {r.sender_username[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{r.sender_username}</p>
                    <p className="text-xs text-[var(--text-secondary)] font-mono">{r.sender_uid}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => acceptRequest(r.id)}
                      className="rounded-lg bg-[var(--success)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 transition"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => declineRequest(r.id)}
                      className="rounded-lg bg-[var(--danger)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 transition"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Search ── */}
          {tab === "search" && (
            <div className="p-4">
              <p className="mb-3 text-xs text-[var(--text-secondary)]">
                Enter a User ID to find and add friends
              </p>
              <div className="flex gap-2">
                <input
                  value={searchUid}
                  onChange={(e) => setSearchUid(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Enter User ID"
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-secondary)]/50"
                />
                <button
                  onClick={handleSearch}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition"
                >
                  🔍
                </button>
              </div>
              {searchError && (
                <p className="mt-3 text-sm text-red-400">{searchError}</p>
              )}
              {searchResult && (
                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-white font-bold">
                      {searchResult.username[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{searchResult.username}</p>
                      <p className="text-xs text-[var(--text-secondary)] font-mono">{searchResult.uid}</p>
                    </div>
                  </div>
                  {searchResult.id !== user.id && (
                    <button
                      onClick={() => sendFriendRequest(searchResult.uid)}
                      className="mt-3 w-full rounded-lg bg-gradient-to-r from-[#6c63ff] to-[#a855f7] py-2 text-sm font-semibold text-white hover:brightness-110 transition"
                    >
                      Send Friend Request
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ CHAT AREA ═══ */}
      <div className="flex flex-1 flex-col bg-[var(--bg-primary)] relative">


        {!selectedFriend ? (
          /* ── No chat selected ── */
          <div className="flex flex-1 flex-col items-center justify-center text-center px-4">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-[#6c63ff]/20 to-[#a855f7]/20 border border-[var(--border)]">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">ChatConnect</h2>
            <p className="text-[var(--text-secondary)] max-w-sm">
              Select a friend to start chatting, or search by User ID to add new friends.
            </p>
            <div className="mt-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] px-6 py-3">
              <p className="text-xs text-[var(--text-secondary)]">Your User ID</p>
              <p className="text-lg font-mono font-bold text-[var(--accent)]">{user.uid}</p>
            </div>
            {/* Mobile sidebar toggle */}
            <button
              onClick={() => setShowSidebar((p) => !p)}
              className="mt-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition md:hidden"
            >
              {showSidebar ? "Hide sidebar" : "Show sidebar"}
            </button>
          </div>
        ) : (
          <>
            {/* ── Chat header ── */}
            <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 flex-shrink-0">
              <button
                onClick={() => {
                  setSelectedFriend(null);
                  setShowSidebar(true);
                }}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition md:hidden"
              >
                ←
              </button>
              <div className="relative flex-shrink-0">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full text-white font-bold text-sm"
                  style={{ background: selectedFriend.avatar_color }}
                >
                  {selectedFriend.username[0]?.toUpperCase()}
                </div>
                {selectedFriend.is_online && (
                  <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-[var(--success)] border-2 border-[var(--bg-secondary)]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{selectedFriend.username}</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {typingUsers.has(selectedFriend.id) ? (
                    <span className="text-[var(--accent)] animate-pulse">typing…</span>
                  ) : selectedFriend.is_online ? (
                    <span className="text-[var(--success)]">Online</span>
                  ) : (
                    `Last seen ${formatLastSeen(selectedFriend.last_seen)}`
                  )}
                </p>
              </div>

              <button
                onClick={() => setShowSidebar((p) => !p)}
                className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition hidden md:block"
              >
                ☰
              </button>
            </div>

            {/* ── Messages ── */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
              {messages.map((m, idx) => {
                const isMine = m.sender_id === user.id;
                const showDate =
                  idx === 0 ||
                  new Date(m.created_at).toDateString() !==
                    new Date(messages[idx - 1].created_at).toDateString();
                return (
                  <div key={m.id}>
                    {showDate && (
                      <div className="flex justify-center my-3">
                        <span className="rounded-full bg-[var(--bg-card)] border border-[var(--border)] px-4 py-1 text-xs text-[var(--text-secondary)]">
                          {new Date(m.created_at).toLocaleDateString(undefined, {
                            weekday: "short", month: "short", day: "numeric",
                          })}
                        </span>
                      </div>
                    )}
                    <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2 relative group ${
                          isMine
                            ? "bg-gradient-to-br from-[#6c63ff] to-[#5a52e0] text-white rounded-br-md"
                            : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-bl-md"
                        }`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (isMine) setContextMenu({ x: e.clientX, y: e.clientY, msg: m });
                        }}
                      >
                        {/* Reply preview */}
                        {m.reply_to_id && m.reply_preview && (
                          <div
                            className={`mb-2 rounded-lg px-3 py-1.5 text-xs border-l-2 ${
                              isMine
                                ? "bg-white/10 border-white/30 text-white/80"
                                : "bg-[var(--bg-hover)] border-[var(--accent)] text-[var(--text-secondary)]"
                            }`}
                          >
                            {m.reply_preview}
                          </div>
                        )}

                        {m.is_deleted ? (
                          <p className="text-sm italic opacity-60">🚫 This message was deleted</p>
                        ) : (
                          <>
                            {/* File attachment */}
                            {m.file_url && (
                              <div className="mb-1">
                                {m.file_type === "image" ? (
                                  <img
                                    src={m.file_url}
                                    alt={m.file_name || "image"}
                                    className="max-w-full rounded-lg max-h-60 object-cover"
                                  />
                                ) : m.file_type === "video" ? (
                                  <video
                                    src={m.file_url}
                                    controls
                                    className="max-w-full rounded-lg max-h-60"
                                  />
                                ) : (
                                  <a
                                    href={m.file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                                      isMine ? "bg-white/10" : "bg-[var(--bg-hover)]"
                                    }`}
                                  >
                                    📄 {m.file_name || "File"}
                                  </a>
                                )}
                              </div>
                            )}
                            {m.content && (
                              <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                            )}
                          </>
                        )}

                        {/* Time + status */}
                        <div className={`flex items-center gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                          <span className={`text-[10px] ${isMine ? "text-white/50" : "text-[var(--text-secondary)]"}`}>
                            {formatTime(m.created_at)}
                          </span>
                          {isMine && !m.is_deleted && (
                            <span style={{ color: statusColor(m.status), fontSize: 10 }}>
                              {statusIcon(m.status)}
                            </span>
                          )}
                        </div>

                        {/* Reply button (hover) */}
                        <button
                          onClick={() => setReplyTo(m)}
                          className={`absolute top-1 ${isMine ? "-left-8" : "-right-8"} opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-secondary)] hover:text-[var(--accent)] text-sm p-1`}
                        >
                          ↩
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Context menu */}
            {contextMenu && (
              <div
                className="fixed z-50 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] py-1 shadow-2xl"
                style={{ top: contextMenu.y, left: contextMenu.x }}
              >
                <button
                  onClick={() => {
                    setReplyTo(contextMenu.msg);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-[var(--bg-hover)] transition"
                >
                  ↩ Reply
                </button>
                <button
                  onClick={() => deleteMessage(contextMenu.msg.id)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-[var(--bg-hover)] transition"
                >
                  🗑 Delete
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(contextMenu.msg.content || "");
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-[var(--bg-hover)] transition"
                >
                  📋 Copy
                </button>
              </div>
            )}

            {/* ── Reply bar ── */}
            {replyTo && (
              <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2">
                <div className="flex-1 rounded-lg bg-[var(--bg-primary)] border-l-2 border-[var(--accent)] px-3 py-2 text-sm text-[var(--text-secondary)] truncate">
                  ↩ Replying to: {replyTo.content || "[file]"}
                </div>
                <button onClick={() => setReplyTo(null)} className="text-[var(--text-secondary)] hover:text-red-400 font-bold transition">
                  ✕
                </button>
              </div>
            )}

            {/* ── Emoji picker ── */}
            {showEmojiPicker && (
              <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {EMOJIS.map((em) => (
                    <button
                      key={em}
                      onClick={() => {
                        setInput((prev) => prev + em);
                        setShowEmojiPicker(false);
                      }}
                      className="text-2xl hover:scale-125 transition-transform"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Input bar ── */}
            <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 flex-shrink-0">
              <button
                onClick={() => setShowEmojiPicker((p) => !p)}
                className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-yellow-400 transition text-lg"
              >
                😊
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] transition"
              >
                📎
              </button>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept="image/*,video/*,.pdf,.doc,.docx,.zip"
                onChange={handleFileUpload}
              />
              <input
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Type a message…"
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-2.5 text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-secondary)]/50 transition"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#6c63ff] to-[#a855f7] text-white hover:brightness-110 transition disabled:opacity-30 flex-shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
