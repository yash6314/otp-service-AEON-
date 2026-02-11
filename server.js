import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

/* ---------------- BASIC SETUP ---------------- */
const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ---------------- HELPERS ---------------- */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendSMS(phone, otp) {
  const response = await axios.get("https://www.smsstriker.com/API/sms.php", {
    params: {
      username: process.env.SMS_USERNAME,
      password: process.env.SMS_PASSWORD,
      from: process.env.SMS_SENDER_ID,
      to: phone,
      msg: `Dear user,
Your OTP for AEON 2026 is${otp}. Please do not share this OTP with anyone.
-AEON, Mahindra University.`,
      type: 1,
      template_id: process.env.SMS_TEMPLATE_ID
    }
  });

  console.log("SMS STRIKER RESPONSE:", response.data);
  return response.data;
}

/* ---------------- SEND OTP ---------------- */
app.post("/api/send-otp", async (req, res) => {
  const { phone } = req.body;

  // ✅ Phone validation (India)
  const phoneRegex = /^[6-9]\d{9}$/;

  if (!phone || !phoneRegex.test(phone)) {
    return res.status(400).json({
      success: false,
      message: "Invalid phone number"
    });
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
 // UTC

  try {
    // ✅ DELETE old unverified OTPs (do NOT mark them verified)
    await supabase
      .from("otp_verification")
      .delete()
      .eq("phone", phone)
      .eq("verified", false);

    // ✅ Insert new OTP
    await supabase
      .from("otp_verification")
      .insert([
        {
          phone,
          otp,
          expires_at: expiresAt
          // event_name defaults automatically
        }
      ]);

    const smsResp = await sendSMS(phone, otp);

    // Optional safety check
    if (!smsResp || smsResp.toString().toLowerCase().includes("error")) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP"
      });
    }

    res.json({
      success: true,
      message: "OTP sent successfully"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

/* ---------------- VERIFY OTP ---------------- */
app.post("/api/verify-otp", async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({
      success: false,
      message: "Phone and OTP required"
    });
  }

  try {
    const { data } = await supabase
      .from("otp_verification")
      .select("*")
      .eq("phone", phone)
      .eq("otp", otp)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!data || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    const record = data[0];

    // ✅ UTC vs UTC comparison (FIXED)
    const nowUTC = new Date().toISOString();
    if (record.expires_at < nowUTC) {
      return res.status(400).json({
        success: false,
        message: "OTP expired"
      });
    }

    // ✅ Mark OTP as verified ONLY here
    await supabase
      .from("otp_verification")
      .update({ verified: true })
      .eq("id", record.id);

    res.json({
      success: true,
      message: "OTP verified"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

/* ---------------- START SERVER ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OTP service running on port ${PORT}`);
});
