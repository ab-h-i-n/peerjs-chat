import { useState, useEffect, useRef } from 'react';
import { Send, Users, XCircle, Wifi } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// Replace with your Supabase credentials
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log(SUPABASE_ANON_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function App() {
  const [peerId, setPeerId] = useState('');
  const [conn, setConn] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [status, setStatus] = useState('connecting');
  const [waitingForPeer, setWaitingForPeer] = useState(false);
  
  const peerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const checkIntervalRef = useRef(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.4.7/peerjs.min.js';
    script.onload = initPeer;
    document.body.appendChild(script);

    return () => {
      if (peerRef.current) {
        removeFromWaitingPool();
        peerRef.current.destroy();
      }
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const initPeer = () => {
    const peer = new window.Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerId(id);
      setStatus('ready');
      addSystemMessage('Connected to server. Ready to chat!');
    });

    peer.on('connection', (connection) => {
      console.log('Incoming connection from:', connection.peer);
      
      // If we're already connected, reject
      if (conn && conn.open) {
        connection.close();
        return;
      }
      
      // Accept the connection
      setupConnection(connection);
      setWaitingForPeer(false);
      
      // Remove from pool when someone connects to us
      removeFromWaitingPool();
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    });

    peer.on('disconnected', () => {
      console.log('Peer disconnected from server');
      setStatus('disconnected');
      // Try to reconnect
      if (!peer.destroyed) {
        peer.reconnect();
      }
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      if (err.type === 'network' || err.type === 'server-error') {
        setStatus('error');
        addSystemMessage('Connection error. Refresh the page.');
      }
    });
  };

  const setupConnection = (connection) => {
    setConn(connection);
    setStatus('connected');
    setWaitingForPeer(false);

    connection.on('data', (data) => {
      setMessages(prev => [...prev, { text: data, sender: 'them', time: new Date() }]);
    });

    connection.on('close', () => {
      setStatus('ready');
      setConn(null);
      addSystemMessage('Stranger disconnected');
    });

    connection.on('open', () => {
      console.log('Connection established!');
      setStatus('connected');
      addSystemMessage('Connected to stranger! Say hi! 👋');
    });

    connection.on('error', (err) => {
      console.error('Connection error:', err);
      setStatus('ready');
      setConn(null);
      addSystemMessage('Connection error occurred');
    });
  };

  const addToWaitingPool = async () => {
    try {
      const { error } = await supabase
        .from('waiting_pool')
        .insert([
          { 
            peer_id: peerId, 
            created_at: new Date().toISOString() 
          }
        ]);
      
      if (error) throw error;
    } catch (error) {
      console.error('Error adding to pool:', error);
    }
  };

  const removeFromWaitingPool = async () => {
    if (!peerId) return;
    try {
      await supabase
        .from('waiting_pool')
        .delete()
        .eq('peer_id', peerId);
    } catch (error) {
      console.error('Error removing from pool:', error);
    }
  };

  const findRandomPeer = async () => {
    if (!peerRef.current || !peerId) return;
    
    setWaitingForPeer(true);
    setMessages([]);
    addSystemMessage('Looking for a stranger to chat with...');
    
    // Add self to waiting pool
    await addToWaitingPool();
    
    let attemptCount = 0;
    const maxAttempts = 20;
    
    // Check for available peers periodically
    checkIntervalRef.current = setInterval(async () => {
      attemptCount++;
      
      if (attemptCount > maxAttempts) {
        cancelSearch();
        addSystemMessage('No one available right now. Try again!');
        return;
      }
      
      try {
        // First check if we're still in the pool (might have been matched)
        const { data: selfCheck } = await supabase
          .from('waiting_pool')
          .select('peer_id')
          .eq('peer_id', peerId)
          .single();
        
        if (!selfCheck) {
          // We were removed, probably matched by another peer
          clearInterval(checkIntervalRef.current);
          return;
        }
        
        const { data, error } = await supabase
          .from('waiting_pool')
          .select('peer_id, created_at')
          .neq('peer_id', peerId)
          .order('created_at', { ascending: true })
          .limit(1);
        
        if (error) throw error;
        
        if (data && data.length > 0) {
          const targetPeer = data[0].peer_id;
          
          console.log('Found peer:', targetPeer);
          
          // Try to remove both from pool
          const { error: deleteError } = await supabase
            .from('waiting_pool')
            .delete()
            .in('peer_id', [peerId, targetPeer]);
          
          if (!deleteError) {
            clearInterval(checkIntervalRef.current);
            addSystemMessage('Found someone! Connecting...');
            
            // Small delay to ensure both peers are ready
            setTimeout(() => {
              connectToPeer(targetPeer);
            }, 500);
          }
        }
      } catch (error) {
        console.error('Error finding peer:', error);
      }
    }, 1500);
  };

  const connectToPeer = (targetPeerId) => {
    const connection = peerRef.current.connect(targetPeerId, {
      reliable: true
    });
    
    let connectionTimeout = setTimeout(() => {
      if (connection.open === false) {
        connection.close();
        setWaitingForPeer(false);
        addSystemMessage('Connection failed. Try again!');
        setStatus('ready');
      }
    }, 10000);

    connection.on('open', () => {
      clearTimeout(connectionTimeout);
      setupConnection(connection);
      setWaitingForPeer(false);
    });

    connection.on('error', (err) => {
      clearTimeout(connectionTimeout);
      console.log('Connection error:', err);
      setWaitingForPeer(false);
      addSystemMessage('Connection failed. Try again!');
      setStatus('ready');
    });
  };

  const addSystemMessage = (text) => {
    setMessages(prev => [...prev, { text, sender: 'system', time: new Date() }]);
  };

  const sendMessage = () => {
    if (!inputMsg.trim() || !conn) return;

    const msg = inputMsg.trim();
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
    if (conn) {
      conn.close();
      setConn(null);
      setStatus('ready');
      addSystemMessage('You disconnected');
    }
    cancelSearch();
  };

  const cancelSearch = async () => {
    setWaitingForPeer(false);
    await removeFromWaitingPool();
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-red-500 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[600px] flex flex-col">
        <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white p-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-6 h-6" />
              <h1 className="text-xl font-bold">Random Chat</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                status === 'connected' ? 'bg-green-400' : 
                status === 'ready' ? 'bg-yellow-400' : 
                'bg-red-400'
              }`} />
              <span className="text-sm">{status}</span>
            </div>
          </div>
          {peerId && (
            <p className="text-xs mt-2 opacity-75">Your ID: {peerId.substring(0, 8)}...</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {status === 'connecting' && (
            <div className="text-center text-gray-400 mt-8">
              <div className="w-12 h-12 mx-auto mb-4 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
              <p className="font-semibold">Connecting to server...</p>
              <p className="text-xs mt-2">Please wait</p>
            </div>
          )}
          {status !== 'connecting' && messages.length === 0 && (
            <div className="text-center text-gray-400 mt-8">
              <Wifi className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Click "Find Stranger" to start chatting</p>
              <p className="text-xs mt-2">Open in multiple tabs to test!</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${
                msg.sender === 'me' ? 'justify-end' : 
                msg.sender === 'system' ? 'justify-center' : 
                'justify-start'
              }`}
            >
              {msg.sender === 'system' ? (
                <div className="bg-gray-300 text-gray-700 text-xs px-3 py-1 rounded-full">
                  {msg.text}
                </div>
              ) : (
                <div
                  className={`max-w-xs px-4 py-2 rounded-2xl ${
                    msg.sender === 'me'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white text-gray-800 border border-gray-200'
                  }`}
                >
                  <p className="break-words">{msg.text}</p>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-gray-200 rounded-b-2xl">
          {status === 'connected' ? (
            <>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <button
                  onClick={sendMessage}
                  className="bg-purple-600 text-white p-2 rounded-full hover:bg-purple-700 transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              <button
                onClick={disconnect}
                className="w-full bg-red-500 text-white py-2 rounded-full hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
              >
                <XCircle className="w-5 h-5" />
                Disconnect
              </button>
            </>
          ) : waitingForPeer ? (
            <button
              onClick={cancelSearch}
              className="w-full bg-gray-500 text-white py-3 rounded-full hover:bg-gray-600 transition-all font-semibold"
            >
              Cancel Search
            </button>
          ) : (
            <button
              onClick={findRandomPeer}
              disabled={status !== 'ready'}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3 rounded-full hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold flex items-center justify-center gap-2"
            >
              {status === 'connecting' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Connecting...
                </>
              ) : (
                'Find Stranger'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}