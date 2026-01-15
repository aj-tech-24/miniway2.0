import React, { createContext, ReactNode, useContext, useState } from 'react';

interface CommuterUIContextType {
    isPinDroppingMode: boolean;
    setIsPinDroppingMode: (value: boolean) => void;
}

const CommuterUIContext = createContext<CommuterUIContextType | undefined>(undefined);

export function CommuterUIProvider({ children }: { children: ReactNode }) {
    const [isPinDroppingMode, setIsPinDroppingMode] = useState(false);

    return (
        <CommuterUIContext.Provider value={{ isPinDroppingMode, setIsPinDroppingMode }}>
            {children}
        </CommuterUIContext.Provider>
    );
}

export function useCommuterUI() {
    const context = useContext(CommuterUIContext);
    if (context === undefined) {
        throw new Error('useCommuterUI must be used within a CommuterUIProvider');
    }
    return context;
}
