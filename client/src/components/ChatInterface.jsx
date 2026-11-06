import { useState, useEffect, useRef } from 'react';
import { TextInput, Button, InlineLoading } from '@carbon/react';
import { Send } from '@carbon/icons-react';
import { sendMessage, getHistory } from '../services/api';
import './ChatInterface.css';

export default function ChatInterface() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    getHistory()
      .then(setMessages)
      .catch(() => setError('Could not load conversation history.'));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const { reply } = await sendMessage(text);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSend();
  }

  return (
    <div className="chat-panel">
      <h4 className="panel-title">Conversation</h4>
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            <span className="chat-role">{msg.role === 'user' ? 'You' : 'Agent'}</span>
            <p>{msg.content}</p>
          </div>
        ))}
        {loading && <InlineLoading description="Agent is thinking…" />}
        <div ref={bottomRef} />
      </div>
      {error && <p className="chat-error">{error}</p>}
      <div className="chat-input-row">
        <TextInput
          id="chat-input"
          labelText=""
          hideLabel
          placeholder="Ask the Sales Operations Agent…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <Button
          renderIcon={Send}
          iconDescription="Send"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
