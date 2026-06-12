import { useState, useEffect } from 'react';
import type { UserProfile, Transaction } from '../types';
import { pocketMoneyService } from '../services/pocketMoneyService';

export const useChildren = (parentUid: string | undefined) => {
  const [prevParentUid, setPrevParentUid] = useState<string | undefined>(parentUid);
  const [children, setChildren] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(!!parentUid);

  // Synchronously update state during render if parentUid changes
  if (parentUid !== prevParentUid) {
    setPrevParentUid(parentUid);
    setChildren([]);
    setLoading(!!parentUid);
  }

  useEffect(() => {
    if (!parentUid) {
      return;
    }

    const unsubscribe = pocketMoneyService.subscribeToChildren(parentUid, (list) => {
      setChildren(list);
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, [parentUid]);

  return { children, loading };
};

export const useTransactions = (userId: string | undefined) => {
  const [prevUserId, setPrevUserId] = useState<string | undefined>(userId);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(!!userId);

  // Synchronously update state during render if userId changes
  if (userId !== prevUserId) {
    setPrevUserId(userId);
    setTransactions([]);
    setLoading(!!userId);
  }

  useEffect(() => {
    if (!userId) {
      return;
    }

    const unsubscribe = pocketMoneyService.subscribeToTransactions(userId, (list) => {
      setTransactions(list);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userId]);

  return { transactions, loading };
};

