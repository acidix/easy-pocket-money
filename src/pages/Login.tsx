import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogIn, Key, User, AlertCircle } from 'lucide-react';
import { ThemePicker } from '../components/ThemePicker';
export const Login: React.FC = () => {
  const { loginWithGoogle, loginChild, isDemo } = useAuth();
  const [activeTab, setActiveTab] = useState<'parent' | 'child'>('parent');
  
  // Child form states
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingChild, setLoadingChild] = useState(false);

  const handleGoogleLogin = async () => {
    try {
      setError(null);
      await loginWithGoogle();
    } catch (err: unknown) {
      console.error(err);
      setError('Fehler bei der Anmeldung mit Google.');
    }
  };

  const handleChildLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !pin.trim()) {
      setError('Bitte Benutzername und PIN eingeben.');
      return;
    }

    setLoadingChild(true);
    setError(null);
    try {
      await loginChild(username, pin);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Fehler beim Einloggen.');
    } finally {
      setLoadingChild(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '80vh',
      padding: '1rem',
      gap: '1.5rem'
    }}>
      <ThemePicker />
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '440px',
        padding: '2.5rem',
        position: 'relative'
      }}>
        
        {/* Demo Mode Notice */}
        {isDemo && (
          <div className="flex-align-center" style={{
            background: 'var(--color-warning-bg)',
            color: 'var(--color-warning)',
            padding: '0.75rem 1rem',
            borderRadius: '12px',
            fontSize: '0.85rem',
            fontWeight: 500,
            marginBottom: '1.5rem',
            border: '1px solid rgba(245, 158, 11, 0.2)',
            gap: '0.5rem'
          }}>
            <AlertCircle size={16} />
            <span><strong>Demo-Modus aktiv:</strong> Läuft offline über LocalStorage. Daten bleiben im Browser gespeichert.</span>
          </div>
        )}

        <div className="text-center" style={{ marginBottom: '2.5rem' }}>
          <div style={{ display: 'inline-flex', justifyContent: 'center', marginBottom: '1rem' }}>
            <div className="logo-icon" style={{ width: '56px', height: '56px', borderRadius: '16px', fontSize: '1.6rem' }}>
              €
            </div>
          </div>
          <h1 className="logo-text" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Easy Pocket Money</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Taschengeld spielend leicht verwalten & sparen
          </p>
        </div>

        {/* Tab Toggle */}
        <div style={{
          display: 'flex',
          background: 'var(--border-color)',
          padding: '4px',
          borderRadius: '12px',
          marginBottom: '2rem'
        }}>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: activeTab === 'parent' ? 'var(--bg-surface-opaque)' : 'transparent',
              color: activeTab === 'parent' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '8px',
              padding: '0.5rem'
            }}
            onClick={() => { setActiveTab('parent'); setError(null); }}
          >
            Eltern-Login
          </button>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: activeTab === 'child' ? 'var(--bg-surface-opaque)' : 'transparent',
              color: activeTab === 'child' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: '8px',
              padding: '0.5rem'
            }}
            onClick={() => { setActiveTab('child'); setError(null); }}
          >
            Kinder-Login
          </button>
        </div>

        {error && (
          <div style={{
            background: 'var(--color-danger-bg)',
            color: 'var(--color-danger)',
            padding: '0.75rem 1rem',
            borderRadius: '10px',
            fontSize: '0.875rem',
            marginBottom: '1.5rem',
            fontWeight: 500,
            border: '1px solid rgba(251, 113, 133, 0.2)'
          }}>
            {error}
          </div>
        )}

        {activeTab === 'parent' ? (
          <div>
            <p style={{
              color: 'var(--text-secondary)',
              fontSize: '0.9rem',
              textAlign: 'center',
              lineHeight: 1.5,
              marginBottom: '2rem'
            }}>
              Melde dich als Elternteil mit deinem Google-Konto an, um Kinderprofile zu erstellen, Taschengeld-Sparraten einzurichten und Transaktionen freizugeben.
            </p>
            
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.85rem' }}
              onClick={handleGoogleLogin}
            >
              <LogIn size={18} />
              <span>Mit Google anmelden</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleChildLogin}>
            <div className="form-group">
              <label className="form-label" htmlFor="child-username">
                Benutzername
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  id="child-username"
                  type="text"
                  className="form-input"
                  placeholder="z.B. max123"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={{ paddingLeft: '2.5rem' }}
                  required
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <label className="form-label" htmlFor="child-pin">
                PIN-Code
              </label>
              <div style={{ position: 'relative' }}>
                <Key size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  id="child-pin"
                  type="password"
                  inputMode="numeric"
                  className="form-input"
                  placeholder="Dein PIN-Code"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  style={{ paddingLeft: '2.5rem' }}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.85rem' }}
              disabled={loadingChild}
            >
              {loadingChild ? 'Wird angemeldet...' : 'Anmelden'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
