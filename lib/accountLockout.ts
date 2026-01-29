import { supabase } from "./supabase";

// Configuration
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

export interface LockoutStatus {
    isLocked: boolean;
    remainingMinutes: number;
    failedAttempts: number;
    message?: string;
}

/**
 * Check if an account is currently locked out
 * @param email - The user's email address
 * @returns LockoutStatus object with lock state and remaining time
 */
/**
 * Check if an account is currently locked out
 * @param email - The user's email address
 * @returns LockoutStatus object with lock state and remaining time
 */
export async function checkAccountLockout(email: string): Promise<LockoutStatus> {
    try {
        const { data, error } = await supabase
            .rpc("get_lockout_status", { email_input: email.trim().toLowerCase() });

        if (error) {
            console.error("Error checking lockout status (RPC):", error);
            return { isLocked: false, remainingMinutes: 0, failedAttempts: 0 };
        }

        if (!data) {
            return { isLocked: false, remainingMinutes: 0, failedAttempts: 0 };
        }

        const { isLocked, remainingMinutes, failedAttempts } = data;

        if (isLocked) {
            return {
                isLocked: true,
                remainingMinutes,
                failedAttempts,
                message: `Account is temporarily locked. Please try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
            };
        }

        return {
            isLocked: false,
            remainingMinutes: 0,
            failedAttempts,
        };
    } catch (error) {
        console.error("Error in checkAccountLockout:", error);
        return { isLocked: false, remainingMinutes: 0, failedAttempts: 0 };
    }
}

/**
 * Record a failed login attempt and lock account if threshold reached
 * @param email - The user's email address
 * @returns Updated lockout status
 */
export async function recordFailedAttempt(email: string): Promise<LockoutStatus> {
    try {
        const { data, error } = await supabase
            .rpc("increment_failed_login_attempts", { email_input: email.trim().toLowerCase() });

        if (error) {
            console.error("Error incrementing failed attempts (RPC):", error);
            // Fallback: return default state so we don't crash, but log error
            return { isLocked: false, remainingMinutes: 0, failedAttempts: 0 };
        }

        // data structure: { isLocked, failedAttempts, remainingMinutes }
        if (!data) {
            return { isLocked: false, remainingMinutes: 0, failedAttempts: 0 };
        }

        const { isLocked, remainingMinutes, failedAttempts } = data as any;

        if (isLocked) {
            return {
                isLocked: true,
                remainingMinutes,
                failedAttempts,
                message: `Too many failed login attempts. Account is locked for ${remainingMinutes} minutes.`,
            };
        }

        const attemptsRemaining = MAX_FAILED_ATTEMPTS - failedAttempts;
        return {
            isLocked: false,
            remainingMinutes: 0,
            failedAttempts,
            message: `Invalid credentials. ${attemptsRemaining} attempt${attemptsRemaining !== 1 ? 's' : ''} remaining before account lockout.`,
        };
    } catch (error) {
        console.error("Error in recordFailedAttempt:", error);
        return { isLocked: false, remainingMinutes: 0, failedAttempts: 0 };
    }
}

/**
 * Reset failed login attempts after successful login
 * @param email - The user's email address
 */
export async function resetFailedAttempts(email: string): Promise<void> {
    try {
        const { error } = await supabase
            .rpc("reset_failed_login_attempts", { email_input: email.trim().toLowerCase() });

        if (error) {
            console.error("Error resetting failed attempts (RPC):", error);
        }
    } catch (error) {
        console.error("Error in resetFailedAttempts:", error);
    }
}

/**
 * Get the lockout configuration
 */
export function getLockoutConfig() {
    return {
        maxAttempts: MAX_FAILED_ATTEMPTS,
        lockoutDurationMinutes: LOCKOUT_DURATION_MINUTES,
    };
}
