import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { pocketMoneyService } from '../services/pocketMoneyService';
import type { UserProfile, InvestmentOffer } from '../types';
import { Plus, Trash2, Key, Info, Coins } from 'lucide-react';

const PREDEFINED_FUNDS = [
  {
    tickerSymbol: 'URTH',
    name: 'Weltweite Firmen (MSCI World)',
    categoryName: 'Weltweit 🌍',
    description: 'Investiert in über 1.500 der größten Firmen der Welt (z.B. Apple, Microsoft, Amazon). Sehr breit gestreut und risikoarm.'
  },
  {
    tickerSymbol: 'QQQ',
    name: 'Technologie & Zukunft (Nasdaq 100)',
    categoryName: 'Technologie 💻',
    description: 'Fokus auf zukunftsweisende Internet-, Software- und Computer-Unternehmen (z.B. Google, Nvidia, Meta).'
  },
  {
    tickerSymbol: 'EXS1.DE',
    name: 'Deutsche Firmen (DAX)',
    categoryName: 'Deutschland 🇩🇪',
    description: 'Investiert in die 40 größten und bekanntesten Unternehmen in Deutschland (z.B. SAP, Siemens, Allianz, BMW).'
  },
  {
    tickerSymbol: 'ICLN',
    name: 'Grüne Energie & Umwelt (Clean Energy)',
    categoryName: 'Nachhaltigkeit 🌱',
    description: 'Investiert in zukunftsträchtige Firmen für umweltfreundlichen Strom (z.B. Wind- und Solarkraftwerke).'
  },
  {
    tickerSymbol: 'GLD',
    name: 'Sicherer Hafen (Gold Trust)',
    categoryName: 'Rohstoffe 🪙',
    description: 'Spiegelt den Goldpreis wider. Gold gilt als sicherer Hafen, wenn andere Aktienmärkte schwanken.'
  },
  {
    tickerSymbol: 'HERO',
    name: 'Spiele & Gaming (Video Games)',
    categoryName: 'Gaming 🎮',
    description: 'Investiert in Entwickler von Videospielen, Konsolen und Gaming-Zubehör (z.B. Nintendo, Sony, EA).'
  }
];

interface InvestmentOffersTabProps {
  childrenList: UserProfile[];
}

export const InvestmentOffersTab: React.FC<InvestmentOffersTabProps> = ({ childrenList }) => {
  const { user } = useAuth();
  const [offers, setOffers] = useState<InvestmentOffer[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states - API Key
  const [apiKey, setApiKey] = useState(user?.twelveDataApiKey || '');
  const [savingKey, setSavingKey] = useState(false);
  const [apiKeySuccess, setApiKeySuccess] = useState(false);

  // Form states - Create Offer
  const [offerName, setOfferName] = useState('');
  const [offerType, setOfferType] = useState<'festgeld' | 'aktienfonds'>('festgeld');
  
  // Festgeld Form states
  const [interestRate, setInterestRate] = useState('4.0');
  const [durationMonths, setDurationMonths] = useState('6');

  // Aktienfonds Form states
  const [selectedFundIndex, setSelectedFundIndex] = useState('0'); // Index in PREDEFINED_FUNDS or 'custom'
  const [customTicker, setCustomTicker] = useState('');
  const [customFundName, setCustomFundName] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [customDescription, setCustomDescription] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = pocketMoneyService.subscribeToInvestmentOffers(user.uid, (data) => {
      setOffers(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  // Update local API key state if user profile changes
  useEffect(() => {
    if (user?.twelveDataApiKey) {
      requestAnimationFrame(() => {
        setApiKey(user.twelveDataApiKey || '');
      });
    }
  }, [user?.twelveDataApiKey]);

  const handleSaveApiKey = async () => {
    if (!user) return;
    setSavingKey(true);
    setApiKeySuccess(false);
    try {
      // 1. Update parent profile
      await pocketMoneyService.updateUserProfile(user.uid, { twelveDataApiKey: apiKey.trim() });
      
      // 2. Propagate API key to all linked children so they can query prices client-side
      for (const child of childrenList) {
        await pocketMoneyService.updateUserProfile(child.uid, { twelveDataApiKey: apiKey.trim() });
      }

      setApiKeySuccess(true);
      setTimeout(() => setApiKeySuccess(false), 3000);
    } catch (err) {
      console.error('Error saving API Key:', err);
    } finally {
      setSavingKey(false);
    }
  };

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(false);

    if (!user) return;
    if (!offerName.trim()) {
      setFormError('Bitte gib dem Angebot einen Namen.');
      return;
    }

    const baseOffer = {
      parentId: user.uid,
      name: offerName.trim(),
      type: offerType,
      currency: childrenList[0]?.currency || 'EUR' // Fallback to first child currency or EUR
    };

    let finalOffer: Omit<InvestmentOffer, 'id'>;

    if (offerType === 'festgeld') {
      const rateNum = parseFloat(interestRate);
      const durationNum = parseInt(durationMonths);
      
      if (isNaN(rateNum) || rateNum <= 0) {
        setFormError('Bitte gib einen gültigen Zinssatz an.');
        return;
      }
      if (isNaN(durationNum) || durationNum <= 0) {
        setFormError('Bitte gib eine gültige Laufzeit an.');
        return;
      }

      finalOffer = {
        ...baseOffer,
        interestRate: rateNum / 100, // store as fraction, e.g. 0.05
        durationMonths: durationNum
      };
    } else {
      // Aktienfonds
      if (selectedFundIndex === 'custom') {
        if (!customTicker.trim() || !customFundName.trim() || !customCategory.trim()) {
          setFormError('Bitte fülle alle Pflichtfelder für den benutzerdefinierten Fonds aus.');
          return;
        }
        finalOffer = {
          ...baseOffer,
          tickerSymbol: customTicker.trim().toUpperCase(),
          name: customFundName.trim(),
          categoryName: customCategory.trim(),
          description: customDescription.trim() || 'Benutzerdefinierter Aktienfonds.'
        };
      } else {
        const predefined = PREDEFINED_FUNDS[parseInt(selectedFundIndex)];
        finalOffer = {
          ...baseOffer,
          tickerSymbol: predefined.tickerSymbol,
          name: predefined.name,
          categoryName: predefined.categoryName,
          description: predefined.description
        };
      }
    }

    try {
      await pocketMoneyService.addInvestmentOffer(finalOffer);
      setFormSuccess(true);
      
      // Reset form
      setOfferName('');
      setCustomTicker('');
      setCustomFundName('');
      setCustomCategory('');
      setCustomDescription('');
      
      setTimeout(() => setFormSuccess(false), 3000);
    } catch (err: unknown) {
      console.error(err);
      setFormError(err instanceof Error ? err.message : 'Fehler beim Erstellen des Angebots.');
    }
  };

  const handleDeleteOffer = async (offerId: string) => {
    if (window.confirm('Möchtest du dieses Anlageangebot wirklich löschen? Bereits getätigte Anlagen der Kinder bleiben davon unberührt.')) {
      try {
        await pocketMoneyService.deleteInvestmentOffer(offerId);
      } catch (err) {
        console.error('Error deleting offer:', err);
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Twelve Data API configuration */}
      <div className="glass-panel p-2">
        <h3 className="form-label" style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Key size={18} className="text-primary" />
          Realtime Börsenkurse (Twelve Data API)
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem', lineHeight: 1.4 }}>
          Für echte, sich aktualisierende Fondskurse nutzen wir die kostenlose Twelve Data API. 
          Wenn du keinen Key einträgst oder das Limit erreicht ist, simuliert die App realistische Kursverläufe.
          Einen kostenlosen Key erhältst du in 10 Sekunden auf <a href="https://twelvedata.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>twelvedata.com</a>.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '260px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Twelve Data API Key eintragen"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveApiKey}
            disabled={savingKey}
          >
            {savingKey ? 'Wird gespeichert...' : 'Key Speichern'}
          </button>
        </div>
        {apiKeySuccess && (
          <p style={{ color: 'var(--color-success)', fontSize: '0.85rem', fontWeight: 600, marginTop: '0.5rem' }}>
            ✓ API-Key erfolgreich gespeichert und für alle Kinder-Profile freigegeben!
          </p>
        )}
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        
        {/* Create new Offer Form */}
        <div className="glass-panel p-2">
          <h3 className="form-label" style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={18} className="text-primary" />
            Neues Anlageangebot erstellen
          </h3>

          <form onSubmit={handleCreateOffer}>
            {formError && (
              <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 500, border: '1px solid rgba(255, 0, 85, 0.2)' }}>
                {formError}
              </div>
            )}
            {formSuccess && (
              <div style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 500, border: '1px solid rgba(0, 255, 102, 0.2)' }}>
                ✓ Anlageangebot erfolgreich erstellt!
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Name des Angebots</label>
              <input
                type="text"
                className="form-input"
                placeholder="z.B. Taschengeld Festzins 6M oder MSCI World"
                value={offerName}
                onChange={(e) => setOfferName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Anlagestruktur</label>
              <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--border-color)', padding: '3px', borderRadius: '10px' }}>
                <button
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    background: offerType === 'festgeld' ? 'var(--bg-surface-opaque)' : 'transparent',
                    color: offerType === 'festgeld' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderRadius: '8px',
                    padding: '0.5rem',
                    fontSize: '0.85rem'
                  }}
                  onClick={() => setOfferType('festgeld')}
                >
                  Festgeld (Zinsgarantie)
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    background: offerType === 'aktienfonds' ? 'var(--bg-surface-opaque)' : 'transparent',
                    color: offerType === 'aktienfonds' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderRadius: '8px',
                    padding: '0.5rem',
                    fontSize: '0.85rem'
                  }}
                  onClick={() => setOfferType('aktienfonds')}
                >
                  Aktienfonds (Börsenkurs)
                </button>
              </div>
            </div>

            {offerType === 'festgeld' ? (
              <div className="grid-2" style={{ gap: '1rem', marginTop: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Zinssatz (% pro Jahr)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Laufzeit</label>
                  <select
                    className="form-select"
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(e.target.value)}
                  >
                    <option value="1">1 Monat</option>
                    <option value="3">3 Monate</option>
                    <option value="6">6 Monate</option>
                    <option value="12">1 Jahr (12M)</option>
                    <option value="24">2 Jahre (24M)</option>
                  </select>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Fonds auswählen</label>
                  <select
                    className="form-select"
                    value={selectedFundIndex}
                    onChange={(e) => setSelectedFundIndex(e.target.value)}
                  >
                    {PREDEFINED_FUNDS.map((fund, index) => (
                      <option key={fund.tickerSymbol} value={index.toString()}>
                        [{fund.categoryName}] {fund.name} ({fund.tickerSymbol})
                      </option>
                    ))}
                    <option value="custom">Benutzerdefinierter Fonds (Eigener Ticker)</option>
                  </select>
                </div>

                {selectedFundIndex === 'custom' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderLeft: '2px solid var(--color-primary)', paddingLeft: '1rem' }}>
                    <div className="form-group">
                      <label className="form-label">Börsenticker (z.B. AAPL, TSLA, BTC-USD)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="z.B. AAPL"
                        value={customTicker}
                        onChange={(e) => setCustomTicker(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Fondsname</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="z.B. Apple Inc. Aktie"
                        value={customFundName}
                        onChange={(e) => setCustomFundName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Kategorie-Beschreibung (für Kinder)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="z.B. Technologie 💻, Rohstoffe 🪙"
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Kid-friendly Erklärung (Was macht diese Firma?)</label>
                      <textarea
                        className="form-input"
                        rows={3}
                        placeholder="z.B. Stellt iPhones, iPads und Computer her. Weltweit sehr beliebt."
                        value={customDescription}
                        onChange={(e) => setCustomDescription(e.target.value)}
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }}>
              <Plus size={16} />
              <span>Angebot freischalten</span>
            </button>
          </form>
        </div>

        {/* Existing Offers List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="glass-panel p-2">
            <h3 className="form-label" style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
              Aktive Anlageangebote ({offers.length})
            </h3>

            {loading ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Angebote werden geladen...</p>
            ) : offers.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                <Coins size={32} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
                <p>Noch keine Anlageangebote eingerichtet.</p>
                <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Erstelle links dein erstes Festgeld oder Aktienfonds-Angebot!</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {offers.map(offer => (
                  <div
                    key={offer.id}
                    className="glass-panel p-2"
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '1rem'
                    }}
                  >
                    <div>
                      <div className="flex-align-center" style={{ gap: '0.5rem' }}>
                        <span className="badge" style={{
                          background: offer.type === 'festgeld' ? 'var(--color-primary-glow)' : 'var(--color-success-bg)',
                          color: offer.type === 'festgeld' ? 'var(--color-primary)' : 'var(--color-success)',
                          fontSize: '0.65rem'
                        }}>
                          {offer.type === 'festgeld' ? 'Festgeld' : 'Aktienfonds'}
                        </span>
                        {offer.type === 'aktienfonds' && offer.categoryName && (
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            {offer.categoryName}
                          </span>
                        )}
                      </div>
                      <h4 style={{ fontSize: '1rem', fontWeight: 700, margin: '0.35rem 0 0.15rem 0' }}>{offer.name}</h4>
                      
                      {offer.type === 'festgeld' ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          Laufzeit: <strong style={{ color: 'var(--text-primary)' }}>{offer.durationMonths} {offer.durationMonths === 1 ? 'Monat' : 'Monate'}</strong> | Rendite: <strong style={{ color: 'var(--color-success)' }}>{((offer.interestRate || 0) * 100).toFixed(1)}% p.a.</strong>
                        </p>
                      ) : (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          Ticker: <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{offer.tickerSymbol}</strong>
                        </p>
                      )}
                      
                      {offer.type === 'aktienfonds' && offer.description && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem', lineHeight: 1.3 }}>
                          {offer.description}
                        </p>
                      )}
                    </div>
                    
                    <button
                      type="button"
                      className="btn btn-danger btn-icon-only"
                      onClick={() => handleDeleteOffer(offer.id)}
                      title="Angebot löschen"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Educational Note */}
          <div className="glass-panel p-2 flex-align-center" style={{ gap: '0.75rem', background: 'var(--color-primary-glow)', border: '1px solid var(--border-glow)' }}>
            <Info size={24} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
              <strong>Lerneffekt für Kinder:</strong> Durch Festzinsen verstehen Kinder, dass langes Warten belohnt wird (Zinseszins).
              Bei Aktienfonds erfahren sie, dass Kurse schwanken können (Chancen & Risiken) und sie selbst entscheiden müssen, wann der richtige Verkaufszeitpunkt ist.
            </p>
          </div>
        </div>

      </div>

    </div>
  );
};
