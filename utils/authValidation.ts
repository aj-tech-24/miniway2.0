
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

// Email existence check removed - handled by Supabase during signup

export const validateSignupForm = (
  fullName: string,
  email: string,
  password: string,
  confirmPassword: string
): ValidationResult => {
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
  }
  // Note: Email existence check removed - Supabase will handle duplicates during signup

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
