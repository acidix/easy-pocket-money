/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { UserProfile } from '../types';
import { pocketMoneyService, isDemoMode } from '../services/pocketMoneyService';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  isDemo: boolean;
  loginWithGoogle: () => Promise<void>;
  loginChild: (username: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | null = null;

    // Subscribe to auth state changes
    const unsubscribeAuth = pocketMoneyService.onAuthStateChanged((profile) => {
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }

      if (!profile) {
        setUser(null);
        setLoading(false);
        return;
      }

      // If user profile is loaded, subscribe to live document updates
      unsubscribeUserDoc = pocketMoneyService.subscribeToUser(profile.uid, (freshProfile) => {
        setUser(freshProfile);
        setLoading(false);
      });
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, []);

  const loginWithGoogle = async () => {
    setLoading(true);
    try {
      const profile = await pocketMoneyService.loginWithGoogle();
      setUser(profile);
    } finally {
      setLoading(false);
    }
  };

  const loginChild = async (username: string, pin: string) => {
    setLoading(true);
    try {
      const profile = await pocketMoneyService.loginChild(username, pin);
      setUser(profile);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await pocketMoneyService.logout();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const refreshUser = async () => {
    if (user) {
      const freshUser = await pocketMoneyService.getUser(user.uid);
      if (freshUser) {
        setUser(freshUser);
      }
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading, 
      isDemo: isDemoMode, 
      loginWithGoogle, 
      loginChild, 
      logout,
      refreshUser
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
