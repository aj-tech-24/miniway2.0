import { supabase } from "@/lib/supabase";

export interface ValidationResult {
  isValid: boolean;
  errors: { [key: string]: string };
}

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

export const validatePassword = (
  password: string
): { isValid: boolean; message?: string } => {
  if (password.length < 6) {
    return {
      isValid: false,
      message: "Password must be at least 6 characters",
    };
  }
  if (password.length > 128) {
    return {
      isValid: false,
      message: "Password must be less than 128 characters",
    };
  }
  return { isValid: true };
};

export const validateFullName = (
  name: string
): { isValid: boolean; message?: string } => {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { isValid: false, message: "Full name is required" };
  }
  if (trimmedName.length < 2) {
    return {
      isValid: false,
      message: "Full name must be at least 2 characters",
    };
  }
  if (trimmedName.length > 50) {
    return {
      isValid: false,
      message: "Full name must be less than 50 characters",
    };
  }
  return { isValid: true };
};

export const checkEmailExists = async (email: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: "dummy_password_to_check_existence",
    });

    // If we get an error about invalid credentials, the email exists
    // If we get an error about user not found, the email doesn't exist
    return !!(
      error?.message?.includes("Invalid login credentials") ||
      error?.message?.includes("Invalid email or password")
    );
  } catch (error) {
    // If there's an error, assume email doesn't exist to allow signup
    return false;
  }
};

export const validateSignupForm = async (
  fullName: string,
  email: string,
  password: string,
  confirmPassword: string
): Promise<ValidationResult> => {
  const errors: { [key: string]: string } = {};

  // Validate full name
  const nameValidation = validateFullName(fullName);
  if (!nameValidation.isValid) {
    errors.fullName = nameValidation.message!;
  }

  // Validate email
  if (!email.trim()) {
    errors.email = "Email is required";
  } else if (!validateEmail(email)) {
    errors.email = "Please enter a valid email address";
  } else {
    // Check if email already exists
    const emailExists = await checkEmailExists(email);
    if (emailExists) {
      errors.email =
        "An account with this email already exists. Please try logging in instead.";
    }
  }

  // Validate password
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) {
    errors.password = passwordValidation.message!;
  }

  // Validate confirm password
  if (!confirmPassword.trim()) {
    errors.confirmPassword = "Please confirm your password";
  } else if (password !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const validateLoginForm = (
  email: string,
  password: string
): ValidationResult => {
  const errors: { [key: string]: string } = {};

  if (!email.trim()) {
    errors.email = "Email is required";
  } else if (!validateEmail(email)) {
    errors.email = "Please enter a valid email address";
  }

  if (!password.trim()) {
    errors.password = "Password is required";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
