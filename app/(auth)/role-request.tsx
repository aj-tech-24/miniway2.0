import { supabase } from "@/lib/supabase";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import AuthForm from "../../components/auth/AuthForm";
import AuthLayout from "../../components/auth/AuthLayout";
import FileUpload from "../../components/FileUpload";
import { useThemeColor } from "../../hooks/useThemeColor";

export default function RoleRequestScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedRole, setSelectedRole] = useState<"driver" | "conductor" | "">(
    ""
  );
  const [resumeFile, setResumeFile] =
    useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const textColor = useThemeColor({}, "text");

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (!fullName.trim()) {
      newErrors.fullName = "Full name is required";
    }

    if (!email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Please enter a valid email address";
    }

    if (!phoneNumber.trim()) {
      newErrors.phoneNumber = "Phone number is required";
    } else if (!/^\+?[\d\s\-\(\)]{10,}$/.test(phoneNumber)) {
      newErrors.phoneNumber = "Please enter a valid phone number";
    }

    if (!selectedRole) {
      newErrors.selectedRole = "Please select a role";
    }

    if (!resumeFile) {
      newErrors.resume = "Resume file is required";
    }

    if (selectedRole === "driver" && !licenseNumber.trim()) {
      newErrors.licenseNumber =
        "Driver's license number is required for drivers";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const uploadResumeToStorage = async (
    file: DocumentPicker.DocumentPickerAsset
  ) => {
    try {
      // Create a unique filename
      const fileExtension = file.name.split(".").pop();
      const fileName = `resumes/${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}.${fileExtension}`;

      // Upload file to Supabase storage
      const { data, error } = await supabase.storage
        .from("role-requests")
        .upload(
          fileName,
          {
            uri: file.uri,
            type: file.mimeType || "application/pdf",
            name: file.name,
          } as any,
          {
            contentType: file.mimeType || "application/pdf",
            upsert: false,
          }
        );

      if (error) {
        console.error("Error uploading resume:", error);
        throw new Error("Failed to upload resume file");
      }

      return data.path;
    } catch (error) {
      console.error("Resume upload error:", error);
      throw error;
    }
  };

  async function handleSubmitRequest() {
    setMessage(null);
    setErrors({});

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      // Upload resume file first
      let resumePath = null;
      if (resumeFile) {
        resumePath = await uploadResumeToStorage(resumeFile);
      }
      // Check if user already has a pending request
      const { data: existingRequest, error: checkError } = await supabase
        .from("role_requests")
        .select("id, status")
        .eq("email", email.trim().toLowerCase())
        .in("status", ["pending", "approved"])
        .maybeSingle();

      if (checkError) {
        console.error("Error checking existing request:", checkError);
        setMessage({
          type: "error",
          text: "Failed to check existing requests. Please try again.",
        });
        return;
      }

      if (existingRequest) {
        if (existingRequest.status === "approved") {
          setMessage({
            type: "error",
            text: "You already have an approved role request. Please contact support if you need assistance.",
          });
          return;
        } else if (existingRequest.status === "pending") {
          setMessage({
            type: "error",
            text: "You already have a pending role request. Please wait for it to be reviewed.",
          });
          return;
        }
      }

      // Create the role request
      const { data, error } = await supabase
        .from("role_requests")
        .insert({
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone_number: phoneNumber.trim(),
          requested_role: selectedRole,
          resume_path: resumePath,
          license_number:
            selectedRole === "driver" ? licenseNumber.trim() : null,
          status: "pending",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating role request:", error);
        setMessage({
          type: "error",
          text: "Failed to submit your request. Please try again.",
        });
        return;
      }

      setMessage({
        type: "success",
        text: `Your ${selectedRole} application has been submitted successfully! We'll review your application and get back to you within 2-3 business days.`,
      });

      // Clear form after successful submission
      setTimeout(() => {
        setFullName("");
        setEmail("");
        setPhoneNumber("");
        setSelectedRole("");
        setResumeFile(null);
        setLicenseNumber("");
        router.push("/login");
      }, 3000);
    } catch (error) {
      console.error("Role request error:", error);
      setMessage({
        type: "error",
        text: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const fields = [
    {
      name: "fullName",
      label: "Full Name",
      placeholder: "Enter your full name",
      value: fullName,
      onChangeText: setFullName,
      autoCapitalize: "words" as const,
      error: errors.fullName,
    },
    {
      name: "email",
      label: "Email Address",
      placeholder: "you@example.com",
      value: email,
      onChangeText: setEmail,
      keyboardType: "email-address" as const,
      autoCapitalize: "none" as const,
      error: errors.email,
    },
    {
      name: "phoneNumber",
      label: "Phone Number",
      placeholder: "+1 (555) 123-4567",
      value: phoneNumber,
      onChangeText: setPhoneNumber,
      keyboardType: "phone-pad" as const,
      error: errors.phoneNumber,
    },
    {
      name: "selectedRole",
      label: "Requested Role",
      placeholder: "Select a role",
      value: selectedRole,
      onChangeText: (text: string) =>
        setSelectedRole(text as "driver" | "conductor" | ""),
      error: errors.selectedRole,
      isSelectField: true,
      options: [
        { label: "Driver", value: "driver" },
        { label: "Conductor", value: "conductor" },
      ],
    },
    ...(selectedRole === "driver"
      ? [
          {
            name: "licenseNumber",
            label: "Driver's License Number",
            placeholder: "Enter your license number",
            value: licenseNumber,
            onChangeText: setLicenseNumber,
            autoCapitalize: "characters" as const,
            error: errors.licenseNumber,
          },
        ]
      : []),
  ];

  return (
    <AuthLayout>
      <AuthForm
        title={
          typeof "Apply for Role" === "string"
            ? "Apply for Role"
            : "Invalid Title"
        }
        subtitle={
          typeof "Join our team as a driver or conductor" === "string"
            ? "Join our team as a driver or conductor"
            : "Invalid Subtitle"
        }
        fields={fields}
        buttonText="Submit Application"
        onButtonPress={handleSubmitRequest}
        isLoading={isLoading}
        message={message}
        footerText="Already have an account?"
        footerLinkText="Log In"
        onFooterLinkPress={() => router.push("/login")}
        textColor={textColor}
        customContent={
          <FileUpload
            label="Upload Resume"
            placeholder="Tap to select your resume (PDF, DOC, DOCX)"
            onFileSelected={(result) => {
              if (
                !result.canceled &&
                result.assets &&
                result.assets.length > 0
              ) {
                setResumeFile(result.assets[0]);
              } else {
                setResumeFile(null);
              }
            }}
            error={errors.resume}
            acceptedTypes={[".pdf", ".doc", ".docx"]}
            maxSize={10}
          />
        }
      />
    </AuthLayout>
  );
}
