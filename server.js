require("dotenv").config();

const nodemailer = require('nodemailer');
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const fs = require('fs');

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || "shopify-game-secret-key-2026";

const app = express();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'rickid812@gmail.com',
        pass: 'mlxvdnzxpkiezrrn'
    }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ storage });

app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static("uploads"));

app.use(cors({
    origin: ["https://d3so7a65.github.io"],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie']
}));

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

function authenticate(req, res, next) {
    const token = req.cookies?.token || (req.headers.authorization?.split(' ')[1]);
    
    if (!token) {
        return res.status(401).json({ error: "Не авторизован" });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        next();
    } catch (error) {
        return res.status(401).json({ error: "Недействительный токен" });
    }
}

async function isAdmin(req, res, next) {
    const token = req.cookies?.token;
    
    if (!token) {
        return res.status(401).json({ error: "Не авторизован" });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await prisma.users.findUnique({
            where: { id: decoded.userId }
        });
        
        if (!user || user.role !== "ADMIN") {
            return res.status(403).json({ error: "Доступ запрещён. Требуются права администратора." });
        }
        
        req.userId = decoded.userId;
        req.userRole = user.role;
        next();
    } catch (error) {
        return res.status(401).json({ error: "Недействительный токен" });
    }
}

app.get("/", (req, res) => {
    res.send("SERVER WORKING");
});

app.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        const existingUser = await prisma.users.findUnique({
            where: { email }
        });

        if (existingUser) {
            return res.status(400).json({ message: "Пользователь уже существует" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.users.create({
            data: {
                email,
                password: hashedPassword,
                name,
                isBanned: false
            }
        });

        const token = jwt.sign(
            { userId: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: "7d" }
        );
        
        res.cookie("token", token, {
            httpOnly: false,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: "lax",
            path: "/",
            secure: false,
        });

        const { password: _, ...userWithoutPassword } = user;
        
        res.json({ 
            message: "Регистрация успешна", 
            user: userWithoutPassword,
            token: token 
        });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ошибка сервера: " + error.message });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await prisma.users.findUnique({
            where: { email }
        });

        if (!user) {
            return res.status(400).json({ message: "Пользователь не найден" });
        }

        if (user.isBanned) {
            return res.status(403).json({ message: "Аккаунт заблокирован администратором", isBanned: true });
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password);

        if (!isPasswordCorrect) {
            return res.status(400).json({ message: "Неверный пароль" });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: "7d" }
        );
        
        res.cookie("token", token, {
            httpOnly: false,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: "lax",
            path: "/",
            secure: false,
        });

        res.json({
            message: "Авторизация успешна",
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                banner: user.banner,
                twoFactorEnabled: user.twoFactorEnabled || false,
                isBanned: user.isBanned || false
            },
            token: token
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

app.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: "Выход выполнен" });
});

app.post('/send-recovery-code', async (req, res) => {
    const { email } = req.body;
    
    try {
        const user = await prisma.users.findUnique({
            where: { email }
        });
        
        if (!user) {
            return res.status(404).json({ message: 'Пользователь с таким email не найден' });
        }
        
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        await prisma.users.update({
            where: { email },
            data: {
                reset_code: code,
                reset_code_expires: new Date(Date.now() + 10 * 60 * 1000)
            }
        });
        
        let emailSent = false;
        let emailError = null;
        
        try {
            const info = await transporter.sendMail({
                from: 'rickid812@gmail.com',
                to: email,
                subject: 'Восстановление пароля - Shopify Game',
                html: `<h2>Ваш код подтверждения: <strong>${code}</strong></h2><p>Код действителен 10 минут.</p>`
            });
            emailSent = true;
            console.log('Email sent:', info.messageId);
        } catch (emailErr) {
            emailError = emailErr.message;
            console.error('Email error:', emailErr);
        }
        
        res.json({ 
            message: emailSent ? 'Код отправлен на вашу почту' : 'Код создан (письмо не отправлено, но вы можете использовать код ниже)',
            code: code,
            emailSent: emailSent,
            debug: !emailSent ? 'Проверьте логи Render для просмотра кода' : undefined
        });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Ошибка сервера: ' + error.message });
    }
});

app.post('/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;
    
    try {
        const user = await prisma.users.findUnique({
            where: { email }
        });
        
        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        await prisma.users.update({
            where: { email },
            data: {
                password: hashedPassword,
                reset_code: null,
                reset_code_expires: null
            }
        });
        
        try {
            await transporter.sendMail({
                from: 'rickid812@gmail.com',
                to: email,
                subject: 'Пароль изменён - Shopify Game',
                html: `<h2>Ваш пароль успешно изменён!</h2><p>Теперь вы можете войти с новым паролем.</p>`
            });
        } catch (emailError) {
            console.error('Ошибка отправки email уведомления:', emailError);
        }
        
        res.json({ message: 'Пароль успешно изменён' });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Ошибка сервера: ' + error.message });
    }
});

app.put("/update-profile", authenticate, upload.fields([{ name: "avatar", maxCount: 1 }, { name: "banner", maxCount: 1 }]), async (req, res) => {
    try {
        const userId = req.userId;
        const { name, email, password } = req.body;
        
        const data = {};
        
        if (name && name.trim()) data.name = name.trim();
        if (email && email.trim()) data.email = email.trim();
        if (password && password.trim()) {
            const hashedPassword = await bcrypt.hash(password, 10);
            data.password = hashedPassword;
        }
        
        if (req.files && req.files.avatar && req.files.avatar[0]) {
            const avatarUrl = `https://shopify-server-3iuh.onrender.com/uploads/${req.files.avatar[0].filename}`;
            data.avatar = avatarUrl;
            console.log("Avatar saved:", avatarUrl);
        }
        
        if (req.files && req.files.banner && req.files.banner[0]) {
            const bannerUrl = `https://shopify-server-3iuh.onrender.com/uploads/${req.files.banner[0].filename}`;
            data.banner = bannerUrl;
            console.log("Banner saved:", bannerUrl);
        }

        if (Object.keys(data).length === 0) {
            return res.status(400).json({ message: "Нет данных для обновления" });
        }

        const updatedUser = await prisma.users.update({
            where: { id: userId },
            data
        });

        const { password: _, ...userWithoutPassword } = updatedUser;
        
        res.json({ 
            message: "Профиль обновлен", 
            user: userWithoutPassword 
        });
    } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({ message: "Ошибка сервера: " + error.message });
    }
});

app.get("/user/:email", async (req, res) => {
    try {
        const { email } = req.params;
        
        const user = await prisma.users.findUnique({
            where: { email: email }
        });
        
        if (!user) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }
        
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            created_at: user.created_at,
            avatar: user.avatar,
            banner: user.banner,
            twoFactorEnabled: user.twoFactorEnabled || false,
            isBanned: user.isBanned || false
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

app.get('/api/check-ban/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await prisma.users.findUnique({
            where: { id: parseInt(userId) },
            select: { isBanned: true }
        });
        res.json({ isBanned: user?.isBanned || false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/airhockey/stats', async (req, res) => {
    const { userEmail, goals, playTime } = req.body;
    if (!userEmail) return res.status(400).json({ error: "userEmail required" });
    try {
        const existing = await prisma.airhockeyStat.findUnique({
            where: { userEmail }
        });
        if (existing) {
            await prisma.airhockeyStat.update({
                where: { userEmail },
                data: {
                    goals: Math.max(existing.goals, goals),
                    playTime: Math.max(existing.playTime, playTime)
                }
            });
        } else {
            await prisma.airhockeyStat.create({
                data: { userEmail, goals, playTime }
            });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/airhockey/stats/:userEmail', async (req, res) => {
    const { userEmail } = req.params;
    try {
        const stats = await prisma.airhockeyStat.findUnique({
            where: { userEmail }
        });
        res.json(stats || { goals: 0, playTime: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/leaderboard/:game', async (req, res) => {
    try {
        const { game } = req.params;
        const scores = await prisma.gameScore.findMany({
            where: { gameName: game },
            orderBy: { score: 'desc' },
            take: 50,
            include: { user: { select: { name: true } } }
        });
        res.json(scores);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/save-score', authenticate, async (req, res) => {
    try {
        const { gameName, score } = req.body;
        const userId = req.userId;
        
        const user = await prisma.users.findUnique({ where: { id: userId } });
        if (user.isBanned) {
            return res.status(403).json({ error: "Аккаунт заблокирован" });
        }
        
        const bestScore = await prisma.gameScore.findFirst({
            where: { userId, gameName },
            orderBy: { score: 'desc' }
        });
        
        await prisma.gameScore.create({
            data: { userId, gameName, score }
        });
        
        const isRecord = !bestScore || score > bestScore.score;
        
        res.json({ success: true, isRecord: isRecord });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user-records', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        
        const user = await prisma.users.findUnique({ where: { id: userId } });
        if (user.isBanned) {
            return res.status(403).json({ error: "Аккаунт заблокирован" });
        }
        
        const records = await prisma.gameScore.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        
        const bestByGame = await prisma.gameScore.groupBy({
            by: ['gameName'],
            where: { userId },
            _max: { score: true }
        });
        
        res.json({ 
            recent: records,
            best: bestByGame
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/2fa/setup', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: "Не указан userId" });
        }
        
        const user = await prisma.users.findUnique({
            where: { id: parseInt(userId) }
        });
        
        if (!user) {
            return res.status(404).json({ error: "Пользователь не найден" });
        }
        
        if (user.twoFactorEnabled) {
            return res.status(400).json({ error: "2FA уже включена" });
        }
        
        const secret = speakeasy.generateSecret({
            name: `ShopifyGame:${user.email}`
        });
        
        await prisma.users.update({
            where: { id: parseInt(userId) },
            data: { twoFactorSecret: secret.base32 }
        });
        
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
        
        res.json({
            secret: secret.base32,
            qrCode: qrCodeUrl
        });
        
    } catch (error) {
        console.error('Setup 2FA error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/2fa/verify', async (req, res) => {
    try {
        const { token, userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: "Не указан userId" });
        }
        
        if (!token || token.length !== 6) {
            return res.status(400).json({ error: "Неверный формат кода" });
        }
        
        const user = await prisma.users.findUnique({
            where: { id: parseInt(userId) }
        });
        
        if (!user || !user.twoFactorSecret) {
            return res.status(400).json({ error: "2FA не настроена" });
        }
        
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: token
        });
        
        if (!verified) {
            return res.status(400).json({ error: "Неверный код" });
        }
        
        await prisma.users.update({
            where: { id: parseInt(userId) },
            data: { twoFactorEnabled: true }
        });
        
        res.json({ success: true, message: "2FA успешно включена" });
        
    } catch (error) {
        console.error('Verify 2FA error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/2fa/disable', async (req, res) => {
    try {
        const { token, userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: "Не указан userId" });
        }
        
        if (!token || token.length !== 6) {
            return res.status(400).json({ error: "Неверный формат кода" });
        }
        
        const user = await prisma.users.findUnique({
            where: { id: parseInt(userId) }
        });
        
        if (!user || !user.twoFactorEnabled) {
            return res.status(400).json({ error: "2FA не включена" });
        }
        
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: token
        });
        
        if (!verified) {
            return res.status(400).json({ error: "Неверный код" });
        }
        
        await prisma.users.update({
            where: { id: parseInt(userId) },
            data: {
                twoFactorEnabled: false,
                twoFactorSecret: null
            }
        });
        
        res.json({ success: true, message: "2FA отключена" });
        
    } catch (error) {
        console.error('Disable 2FA error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/2fa/login', async (req, res) => {
    try {
        const { email, token } = req.body;
        
        const user = await prisma.users.findUnique({
            where: { email }
        });
        
        if (!user) {
            return res.status(404).json({ error: "Пользователь не найден" });
        }
        
        if (!user.twoFactorEnabled) {
            return res.status(400).json({ error: "2FA не включена для этого пользователя" });
        }
        
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: token
        });
        
        if (!verified) {
            return res.status(400).json({ error: "Неверный код" });
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/delete-account', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        
        await prisma.gameScore.deleteMany({ where: { userId } });
        await prisma.airhockeyStat.deleteMany({ where: { userId: userId } });
        await prisma.users.update({
            where: { id: userId },
            data: { isDeleted: true, isBanned: false }
        });
        
        res.clearCookie('token');
        res.json({ success: true, message: "Аккаунт удалён" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/restore-account/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.users.update({
            where: { id: parseInt(id) },
            data: { isDeleted: false, isBanned: false }
        });
        res.json({ success: true, message: "Аккаунт восстановлен" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/user/:id/ban', async (req, res) => {
    try {
        const { id } = req.params;
        const { isBanned } = req.body;
        await prisma.users.update({
            where: { id: parseInt(id) },
            data: { isBanned: isBanned }
        });
        res.json({ success: true, message: isBanned ? "Пользователь заблокирован" : "Пользователь разблокирован" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

let onlineUsersMap = new Map();

app.post('/api/user/heartbeat', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        onlineUsersMap.set(userId, Date.now());
        
        const now = Date.now();
        for (let [id, time] of onlineUsersMap.entries()) {
            if (now - time > 30000) {
                onlineUsersMap.delete(id);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/online', async (req, res) => {
    try {
        const now = Date.now();
        for (let [id, time] of onlineUsersMap.entries()) {
            if (now - time > 30000) {
                onlineUsersMap.delete(id);
            }
        }
        const onlineUsers = Array.from(onlineUsersMap.keys());
        res.json({ onlineUsers });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await prisma.users.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                created_at: true,
                avatar: true,
                isBanned: true,
                isDeleted: true,
                _count: {
                    select: { gameScores: true }
                }
            },
            orderBy: { created_at: 'desc' }
        });
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/scores', async (req, res) => {
    try {
        const scores = await prisma.gameScore.findMany({
            take: 100,
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: { name: true, email: true }
                }
            }
        });
        res.json(scores);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const totalUsers = await prisma.users.count({ where: { isDeleted: false } });
        const totalScores = await prisma.gameScore.count();
        
        const scoresByGame = await prisma.gameScore.groupBy({
            by: ['gameName'],
            _count: { id: true },
            _max: { score: true }
        });
        
        const recentUsers = await prisma.users.findMany({
            take: 5,
            orderBy: { created_at: 'desc' },
            where: { isDeleted: false },
            select: { name: true, email: true, created_at: true }
        });
        
        res.json({
            totalUsers,
            totalScores,
            scoresByGame,
            recentUsers
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/user/:id/role', async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        
        if (!['USER', 'ADMIN'].includes(role)) {
            return res.status(400).json({ error: "Недопустимая роль" });
        }
        
        const user = await prisma.users.update({
            where: { id: parseInt(id) },
            data: { role },
            select: { id: true, name: true, email: true, role: true }
        });
        
        res.json({ message: "Роль обновлена", user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/user/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id);
        
        await prisma.gameScore.deleteMany({ where: { userId } });
        await prisma.airhockeyStat.deleteMany({ where: { userId: userId } });
        await prisma.users.delete({ where: { id: userId } });
        
        res.json({ message: "Пользователь удалён" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/reset-all-scores', async (req, res) => {
    try {
        await prisma.gameScore.deleteMany({});
        res.json({ message: "Все рекорды удалены" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/user/:id/reset-scores', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.gameScore.deleteMany({
            where: { userId: parseInt(id) }
        });
        res.json({ message: "Рекорды пользователя удалены" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});