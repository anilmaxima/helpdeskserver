require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();

// -------------------- Manual CORS Setup (Allow All Origins) --------------------
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // allow all origins
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS'); // allow all methods
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization'); // allow headers
  next();
});

// Handle preflight OPTIONS requests
app.options('*', (req, res) => res.sendStatus(200));

app.use(express.json());

// -------------------- Cloudinary Setup --------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// -------------------- MongoDB Models --------------------
const { Schema } = mongoose;

const TicketSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  description: { type: String, required: true },
  attachmentUrl: { type: String, default: null },
  status: { type: String, enum: ['new', 'in_progress', 'resolved'], default: 'new' },
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new Schema({
  ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
  author: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Ticket = mongoose.model('Ticket', TicketSchema);
const Message = mongoose.model('Message', MessageSchema);

// -------------------- Multer Setup --------------------
const storage = multer.memoryStorage();
const upload = multer({ storage });

// -------------------- MongoDB Connection --------------------
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error(err); process.exit(1); });

// -------------------- Routes --------------------

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (email === 'admin@help.com' && password === process.env.ADMIN_PASS) {
    return res.json({ role: 'admin' });
  }
  return res.json({ role: 'user' });
});

// Helper: upload buffer to Cloudinary
function uploadToCloudinary(fileBuffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'tickets', resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
}

// Create ticket
app.post('/api/tickets', upload.single('attachment'), async (req, res) => {
  try {
    const { name, email, description } = req.body;
    if (!name || !email || !description) {
      return res.status(400).json({ error: 'name, email, description required' });
    }

    let attachmentUrl = null;
    if (req.file) attachmentUrl = await uploadToCloudinary(req.file.buffer);

    const ticket = new Ticket({ name, email, description, attachmentUrl });
    await ticket.save();

    const message = new Message({ ticketId: ticket._id, author: name, message: description });
    await message.save();

    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all tickets
app.get('/api/tickets', async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ createdAt: -1 }).lean();
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get ticket details + messages
app.get('/api/tickets/:id', async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id).lean();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const messages = await Message.find({ ticketId: ticket._id }).sort({ createdAt: 1 }).lean();
    res.json({ ticket, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Respond to ticket
app.post('/api/tickets/:id/respond', async (req, res) => {
  try {
    const { author, message } = req.body;
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const newMessage = new Message({
      ticketId: ticket._id,
      author: author || 'support',
      message
    });
    await newMessage.save();

    res.json(newMessage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update ticket status
app.patch('/api/tickets/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['new', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updatedTicket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    res.json(updatedTicket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- Start Server --------------------
const PORT = process.env.PORT; // use Render-assigned port
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
