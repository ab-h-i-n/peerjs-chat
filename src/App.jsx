import { useState, useEffect, useRef } from 'react';
import { Send, Users, PhoneOff, Search } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// Get Supabase credentials from environment variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('[INIT] Starting app...');
console.log('[INIT] SUPABASE_URL:', SUPABASE_URL ? 'Set' : 'Missing');
console.log('[INIT] SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? 'Set' : 'Missing');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function RandomChatApp() {
  const [peerId, setPeerId] = useState('');
  const [userId, setUserId] = useState('');
  const [conn, setConn] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [status, setStatus] = useState('connecting');
  const [waitingForPeer, setWaitingForPeer] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(0);
  
  const peerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const checkIntervalRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);

  // Generate or get user ID from localStorage
  const getUserId = () => {
    let id = localStorage.getItem('chat_user_id');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
      localStorage.setItem('chat_user_id', id);
      console.log('[USER] Created new user ID:', id);
    } else {
      console.log('[USER] Retrieved existing user ID:', id);
    }
    return id;
  };

  useEffect(() => {
    console.log('[INIT] Loading PeerJS script...');
    
    // Get or create user ID
    const uid = getUserId();
    setUserId(uid);
    
    // Check if PeerJS is already loaded
    if (window.Peer) {
      console.log('[INIT] PeerJS already loaded, initializing...');
      initPeer(uid);
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.4.7/peerjs.min.js';
    script.onload = () => initPeer(uid);
    document.body.appendChild(script);

    // Update online count periodically
    updateOnlineCount();
    const countInterval = setInterval(() => {
      console.log('[ONLINE] Updating online count...');
      updateOnlineCount();
    }, 5000);

    return () => {
      console.log('[CLEANUP] Cleaning up...');
      if (peerRef.current) {
        removeFromOnlineUsers(uid);
        removeFromWaitingPool();
        peerRef.current.destroy();
        peerRef.current = null;
      }
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      clearInterval(countInterval);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateOnlineCount = async () => {
    try {
      console.log('[ONLINE] Cleaning up stale users...');
      const cutoffTime = new Date(Date.now() - 10000).toISOString();
      console.log('[ONLINE] Cutoff time:', cutoffTime);
      
      const { error: deleteError } = await supabase
        .from('online_users')
        .delete()
        .lt('last_seen', cutoffTime);
      
      if (deleteError) {
        console.error('[ONLINE] Error cleaning up:', deleteError);
      } else {
        console.log('[ONLINE] Cleanup successful');
      }

      const { count, error } = await supabase
        .from('online_users')
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.error('[ONLINE] Error getting count:', error);
      } else {
        console.log('[ONLINE] Current online users:', count);
        setOnlineUsers(count || 0);
      }
    } catch (error) {
      console.error('[ONLINE] Exception:', error);
    }
  };

  const addToOnlineUsers = async (uid) => {
    const userIdToUse = uid || userId;
    
    if (!userIdToUse) {
      console.warn('[ONLINE] Cannot add to online users - no user ID');
      return;
    }
    
    try {
      console.log('[ONLINE] Checking if user already in online_users:', userIdToUse);
      
      // Check if user already exists
      const { data: existing, error: checkError } = await supabase
        .from('online_users')
        .select('user_id')
        .eq('user_id', userIdToUse)
        .single();
      
      if (existing) {
        console.log('[ONLINE] User already in database, updating last_seen');
        const { error: updateError } = await supabase
          .from('online_users')
          .update({ 
            last_seen: new Date().toISOString(),
            peer_id: peerId || null
          })
          .eq('user_id', userIdToUse);
        
        if (updateError) {
          console.error('[ONLINE] Error updating:', updateError);
        } else {
          console.log('[ONLINE] Successfully updated last_seen');
        }
      } else {
        console.log('[ONLINE] Adding new user to online_users:', userIdToUse);
        const { data, error } = await supabase
          .from('online_users')
          .insert([
            { 
              user_id: userIdToUse,
              peer_id: peerId || null,
              last_seen: new Date().toISOString() 
            }
          ]);
        
        if (error) {
          console.error('[ONLINE] Error adding to online users:', error);
          console.error('[ONLINE] Error details:', JSON.stringify(error));
        } else {
          console.log('[ONLINE] Successfully added to online users');
          console.log('[ONLINE] Response data:', data);
        }
      }
      
      updateOnlineCount();
      
      // Start heartbeat
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      
      heartbeatIntervalRef.current = setInterval(async () => {
        console.log('[HEARTBEAT] Updating last_seen for:', userIdToUse);
        const { error: heartbeatError } = await supabase
          .from('online_users')
          .update({ 
            last_seen: new Date().toISOString(),
            peer_id: peerRef.current?.id || peerId || null
          })
          .eq('user_id', userIdToUse);
        
        if (heartbeatError) {
          console.error('[HEARTBEAT] Error:', heartbeatError);
        } else {
          console.log('[HEARTBEAT] Success');
        }
      }, 5000); // Update every 5 seconds (half of cleanup time)
    } catch (error) {
      console.error('[ONLINE] Exception adding to online users:', error);
    }
  };

  const removeFromOnlineUsers = async (uid) => {
    const userIdToUse = uid || userId;
    if (!userIdToUse) return;
    
    try {
      console.log('[ONLINE] Removing user from online users:', userIdToUse);
      const { error } = await supabase
        .from('online_users')
        .delete()
        .eq('user_id', userIdToUse);
      
      if (error) {
        console.error('[ONLINE] Error removing:', error);
      } else {
        console.log('[ONLINE] Successfully removed from online users');
      }
    } catch (error) {
      console.error('[ONLINE] Exception removing from online users:', error);
    }
  };

  const initPeer = (uid) => {
    // Prevent multiple initializations
    if (peerRef.current) {
      console.log('[PEER] Already initialized, skipping...');
      return;
    }
    
    console.log('[PEER] Initializing PeerJS (custom server)...');
    // Use custom PeerServer running on localhost:9000 with path /peerjs
    const peer = new window.Peer(undefined, {
      host: 'peerjs-server-3z7d.onrender.com',
      port: 443,
      path: '/peerjs',
      secure: true,
      debug : 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });
    peerRef.current = peer;
    
    const connectionTimeout = setTimeout(() => {
      if (status === 'connecting') {
        console.error('[PEER] Connection timeout');
        setStatus('error');
        addSystemMessage('Connection timeout. Please refresh.');
      }
    }, 10000);

    peer.on('open', (id) => {
      console.log('[PEER] Connected! Peer ID:', id);
      clearTimeout(connectionTimeout);
      setPeerId(id);
      setStatus('ready');
      addSystemMessage('Ready to chat!');
      // Wait a bit for peerId state to update, then add to online users
      setTimeout(() => {
        addToOnlineUsers(uid);
      }, 100);
    });

    peer.on('connection', (connection) => {
      console.log('[PEER] Incoming connection from:', connection.peer);
      
      if (conn && conn.open) {
        console.log('[PEER] Already connected, rejecting new connection');
        connection.close();
        return;
      }
      
      setupConnection(connection);
      setWaitingForPeer(false);
      
      removeFromWaitingPool();
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    });

    peer.on('disconnected', () => {
      console.warn('[PEER] Disconnected from server');
      setStatus('disconnected');
      if (!peer.destroyed) {
        console.log('[PEER] Attempting to reconnect...');
        peer.reconnect();
      }
    });

    peer.on('error', (err) => {
      clearTimeout(connectionTimeout);
      console.error('[PEER] Error:', err.type, err);
      if (err.type === 'network' || err.type === 'server-error') {
        setStatus('error');
        addSystemMessage('Connection error. Please refresh.');
      } else if (err.type === 'unavailable-id') {
        setStatus('connecting');
        addSystemMessage('Reconnecting...');
        setTimeout(() => {
          if (peerRef.current) {
            peerRef.current.destroy();
          }
          initPeer();
        }, 2000);
      }
    });
  };

  const setupConnection = (connection) => {
    console.log('[CONNECTION] Setting up connection with:', connection.peer);
    setConn(connection);
    setStatus('connected');
    setWaitingForPeer(false);

    connection.on('data', (data) => {
      console.log('[MESSAGE] Received:', data);
      setMessages(prev => [...prev, { text: data, sender: 'them', time: new Date() }]);
    });

    connection.on('close', () => {
      console.log('[CONNECTION] Connection closed');
      setStatus('ready');
      setConn(null);
      addSystemMessage('Stranger disconnected');
    });

    connection.on('open', () => {
      console.log('[CONNECTION] Connection established!');
      setStatus('connected');
      addSystemMessage('Connected! Say hi! 👋');
    });

    connection.on('error', (err) => {
      console.error('[CONNECTION] Error:', err);
      setStatus('ready');
      setConn(null);
      addSystemMessage('Connection error occurred');
    });
  };

  const addToWaitingPool = async () => {
    try {
      console.log('[POOL] Adding to waiting pool:', peerId);
      const { error } = await supabase
        .from('waiting_pool')
        .insert([
          { 
            peer_id: peerId, 
            created_at: new Date().toISOString() 
          }
        ]);
      
      if (error) {
        console.error('[POOL] Error adding:', error);
        throw error;
      }
      console.log('[POOL] Successfully added to waiting pool');
    } catch (error) {
      console.error('[POOL] Exception:', error);
    }
  };

  const removeFromWaitingPool = async () => {
    if (!peerId) return;
    
    try {
      console.log('[POOL] Removing from waiting pool:', peerId);
      const { error } = await supabase
        .from('waiting_pool')
        .delete()
        .eq('peer_id', peerId);
      
      if (error) {
        console.error('[POOL] Error removing:', error);
      } else {
        console.log('[POOL] Successfully removed');
      }
    } catch (error) {
      console.error('[POOL] Exception:', error);
    }
  };

  const findRandomPeer = async () => {
    if (!peerRef.current || !peerId) {
      console.error('[SEARCH] Cannot search - missing peer or ID');
      return;
    }
    
    console.log('[SEARCH] Starting search for peer...');
    setWaitingForPeer(true);
    setMessages([]);
    addSystemMessage('Looking for someone to chat with...');
    
    await addToWaitingPool();
    
    let attemptCount = 0;
    const maxAttempts = 20;
    
    checkIntervalRef.current = setInterval(async () => {
      attemptCount++;
      console.log(`[SEARCH] Attempt ${attemptCount}/${maxAttempts}`);
      
      if (attemptCount > maxAttempts) {
        console.log('[SEARCH] Max attempts reached');
        cancelSearch();
        addSystemMessage('No one available. Try again!');
        return;
      }
      
      try {
        const { data: selfCheck } = await supabase
          .from('waiting_pool')
          .select('peer_id')
          .eq('peer_id', peerId)
          .single();
        
        if (!selfCheck) {
          console.log('[SEARCH] Not in pool anymore, stopping search');
          clearInterval(checkIntervalRef.current);
          return;
        }
        
        const { data, error } = await supabase
          .from('waiting_pool')
          .select('peer_id, created_at')
          .neq('peer_id', peerId)
          .order('created_at', { ascending: true })
          .limit(1);
        
        if (error) {
          console.error('[SEARCH] Error querying pool:', error);
          throw error;
        }
        
        if (data && data.length > 0) {
          const targetPeer = data[0].peer_id;
          console.log('[SEARCH] Found peer:', targetPeer);
          
          const { error: deleteError } = await supabase
            .from('waiting_pool')
            .delete()
            .in('peer_id', [peerId, targetPeer]);
          
          if (deleteError) {
            console.error('[SEARCH] Error removing from pool:', deleteError);
          }
          
          if (!deleteError) {
            clearInterval(checkIntervalRef.current);
            addSystemMessage('Found someone! Connecting...');
            
            setTimeout(() => {
              connectToPeer(targetPeer);
            }, 500);
          }
        } else {
          console.log('[SEARCH] No peers available yet');
        }
      } catch (error) {
        console.error('[SEARCH] Exception:', error);
      }
    }, 1500);
  };

  const connectToPeer = (targetPeerId) => {
    console.log('[CONNECT] Connecting to:', targetPeerId);
    const connection = peerRef.current.connect(targetPeerId, {
      reliable: true
    });
    
    let connectionTimeout = setTimeout(() => {
      if (connection.open === false) {
        console.error('[CONNECT] Connection timeout');
        connection.close();
        setWaitingForPeer(false);
        addSystemMessage('Connection failed. Try again!');
        setStatus('ready');
      }
    }, 10000);

    connection.on('open', () => {
      console.log('[CONNECT] Connection opened successfully');
      clearTimeout(connectionTimeout);
      setupConnection(connection);
      setWaitingForPeer(false);
    });

    connection.on('error', (err) => {
      console.error('[CONNECT] Connection error:', err);
      clearTimeout(connectionTimeout);
      setWaitingForPeer(false);
      addSystemMessage('Connection failed. Try again!');
      setStatus('ready');
    });
  };

  const addSystemMessage = (text) => {
    console.log('[SYSTEM]', text);
    setMessages(prev => [...prev, { text, sender: 'system', time: new Date() }]);
  };

  const sendMessage = () => {
    if (!inputMsg.trim() || !conn) {
      console.warn('[MESSAGE] Cannot send - empty or no connection');
      return;
    }

    const msg = inputMsg.trim();
    console.log('[MESSAGE] Sending:', msg);
    setMessages(prev => [...prev, { text: msg, sender: 'me', time: new Date() }]);
    conn.send(msg);
    setInputMsg('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const disconnect = () => {
    console.log('[DISCONNECT] User disconnecting...');
    if (conn) {
      conn.close();
      setConn(null);
      setStatus('ready');
      addSystemMessage('You disconnected');
    }
    cancelSearch();
  };

  const cancelSearch = async () => {
    console.log('[SEARCH] Cancelling search...');
    setWaitingForPeer(false);
    await removeFromWaitingPool();
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
    }
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-[100dvh] bg-gray-900 flex items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-800 w-full max-w-2xl h-screen sm:h-[600px] flex flex-col sm:rounded-lg shadow-2xl">
        {/* WhatsApp-like Header */}
        <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center">
              <Users className="w-5 h-5 text-gray-400" />
            </div>
            <div>
              <h1 className="font-semibold text-base">
                {status === 'connected' ? 'Stranger' : 'Random Chat'}
              </h1>
              <p className="text-xs text-gray-400">
                {status === 'connected' ? 'online' : 'tap below to connect'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-full">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-sm font-semibold">{onlineUsers}</span>
            <span className="text-xs text-gray-400">online</span>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#0b141a]" style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"%3E%3Cg fill="none" fill-rule="evenodd"%3E%3Cg fill="%23ffffff" fill-opacity="0.02"%3E%3Cpath d="M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
        }}>
          {status === 'connecting' && (
            <div className="text-center text-gray-400 mt-16">
              <div className="w-12 h-12 mx-auto mb-4 border-4 border-gray-700 border-t-teal-500 rounded-full animate-spin" />
              <p className="font-semibold">Connecting...</p>
            </div>
          )}
          
          {status !== 'connecting' && messages.length === 0 && (
            <div className="text-center text-gray-500 mt-16 px-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
                <Users className="w-8 h-8 text-gray-600" />
              </div>
              <p className="text-sm mb-2">Click below to find a random stranger</p>
              <p className="text-xs opacity-75">Have anonymous conversations</p>
            </div>
          )}
          
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.sender === 'system' ? (
                <div className="flex justify-center my-3">
                  <div className="bg-gray-800/80 text-gray-300 text-xs px-3 py-1.5 rounded-md shadow">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <div className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'} mb-1`}>
                  <div className={`max-w-[75%] sm:max-w-md px-3 py-2 rounded-lg shadow-md ${
                    msg.sender === 'me'
                      ? 'bg-teal-700 text-white rounded-br-none'
                      : 'bg-gray-800 text-white rounded-bl-none'
                  }`}>
                    <p className="text-sm break-words">{msg.text}</p>
                    <p className={`text-[10px] mt-1 ${
                      msg.sender === 'me' ? 'text-gray-200' : 'text-gray-400'
                    } text-right`}>
                      {formatTime(msg.time)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="bg-gray-900 px-3 py-2">
          {status === 'connected' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message"
                  className="flex-1 bg-gray-800 text-white placeholder-gray-500 px-4 py-2.5 rounded-full focus:outline-none text-sm border border-gray-700 focus:border-teal-600"
                />
                <button
                  onClick={sendMessage}
                  className="bg-teal-600 text-white p-2.5 rounded-full hover:bg-teal-700 transition-colors flex-shrink-0"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              <button
                onClick={disconnect}
                className="w-full bg-red-600 text-white py-2 rounded-full hover:bg-red-700 transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <PhoneOff className="w-4 h-4" />
                End Chat
              </button>
            </div>
          ) : waitingForPeer ? (
            <button
              onClick={cancelSearch}
              className="w-full bg-gray-700 text-white py-2.5 rounded-full hover:bg-gray-600 transition-all font-semibold text-sm"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={findRandomPeer}
              disabled={status !== 'ready'}
              className="w-full bg-teal-600 text-white py-2.5 rounded-full hover:bg-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold flex items-center justify-center gap-2 text-sm"
            >
              {status === 'connecting' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Find Stranger
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}