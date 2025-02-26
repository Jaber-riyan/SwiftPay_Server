require('dotenv').config()

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(cors({
    origin: [
        'http://localhost:5173',
        'https://swifftpay.netlify.app'
    ],
    credentials: true
}));

app.use(cookieParser());

// mongo db connection 
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.PASSWORD}@cluster0.4ayta.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        console.log("successfully connected to MongoDB!");

        // database 
        const database = client.db('SwiftPay');

        // users collection
        const userCollection = database.collection('users');

        // tasks collection 
        const taskCollection = database.collection('tasks');

        // activity collection
        const activityCollection = database.collection('activity');

        // transactions collection 
        const transactionsCollection = database.collection('transactions');

        const totalMoneyCollection = database.collection("totalMoney")


        // middleware
        // verify token middleware
        const verifyToken = (req, res, next) => {
            // console.log("Inside the verify token");
            // console.log("received request:", req?.headers?.authorization);
            if (!req?.headers?.authorization) {
                return res.status(401).json({ message: "Unauthorized Access!" });
            }

            // get token from the headers 
            const token = req?.headers?.authorization;
            // console.log("Received Token", token);

            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    console.error('JWT Verification Error:', err.message);
                    return res.status(401).json({ message: err.message });
                }
                // console.log('Decoded Token:', decoded);
                req.user = decoded;
                next();
            })
        }

        // verify admin middleware after verify token
        const verifyAdmin = async (req, res, next) => {
            const email = req.user.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // verify agent middleware after verify token
        const verifyAgent = async (req, res, next) => {
            const email = req.user.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAgent = user?.role === 'agent' && user?.verified;
            if (!isAgent) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // verify agent middleware after verify token
        const verifyUser = async (req, res, next) => {
            const email = req.user.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAgent = user?.role === 'user';
            if (!isAgent) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        const totalMoneyOfSystem = async (amount) => {
            const systemMoney = await totalMoneyCollection.findOne()
        }

        // JWT token create and remove APIS
        // JWT token create API 
        app.post('/jwt/create', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7h' });

            // res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
            // res.setHeader("Access-Control-Allow-Credentials", "true");

            res.send({ token })
        })

        // users related APIS 
        // insert user API 
        app.post('/users', async (req, res) => {
            try {
                const { pin, ...userData } = req.body;
                // const pin = await bcrypt.hash(user?.pin, 10)
                const existingEmail = await userCollection.findOne({ email: userData?.email });
                const existingPhoneNumber = await userCollection.findOne({ phoneNumber: userData?.phoneNumber });
                const existingNID = await userCollection.findOne({ nid: userData?.nid });


                if (existingEmail) {
                    return res.json({
                        status: false,
                        message: 'This Email Already have, try with another email',
                        data: existingEmail
                    });
                }
                else if (existingPhoneNumber) {
                    return res.json({
                        status: false,
                        message: 'This Phone Number Already have, try with another Number',
                        data: existingPhoneNumber
                    });
                }
                else if (existingNID) {
                    return res.json({
                        status: false,
                        message: 'This NID Already have, try with another NID',
                        data: existingNID
                    });
                }

                else if (!pin || typeof pin !== "string" || pin.length !== 6) {
                    return res.status(400).json({ status: false, message: "PIN must be exactly 6 digits" });
                }

                const hashedPin = await bcrypt.hash(pin, 10);

                const newUser = {
                    ...userData,
                    pin: hashedPin,
                    balance: 0,
                    deviceId: ''
                };

                const insertResult = await userCollection.insertOne(newUser);

                if (userData?.role == "agent") {
                    await userCollection.updateOne({ phoneNumber: userData?.phoneNumber }, { $set: { balance: 100000 } })
                    await userCollection.updateOne({ phoneNumber: userData?.phoneNumber }, { $set: { verified: false } })
                }
                if (userData?.role == "user") {
                    await userCollection.updateOne({ phoneNumber: userData?.phoneNumber }, { $set: { balance: 40 } })
                }

                res.json({
                    status: true,
                    message: 'User Account Created successfully',
                    data: insertResult
                });
            } catch (error) {
                console.error('Error adding/updating user:', error);
                res.status(500).json({
                    status: false,
                    message: 'Failed to add or update user',
                    error: error.message
                });
            }
        });

        // user login API 
        app.post('/login-user', async (req, res) => {
            const { email, pin, deviceId } = req.body;
            const user = await userCollection.findOne({ email: email })
            if (user) {
                const match = await bcrypt.compare(pin, user?.pin);
                if (match && user?.role == "user" || "agent") {
                    if (user?.deviceId == deviceId || !user?.deviceId.length) {
                        const updatedUser = await userCollection.updateOne({ email: email }, { $set: { deviceId: deviceId } })
                        return res.json({
                            status: true,
                            message: "Successfully Login",
                            user,
                            deviceId
                        })
                    }
                    else if (user?.deviceId != deviceId) {
                        return res.json({
                            status: false,
                            deviceLogin: true,
                            message: "You are already logged in on another device",
                            user,
                            deviceId
                        });
                    }
                }
                else if (match || user?.role == "admin") {
                    return res.json({
                        status: true,
                        message: "Successfully Login",
                        user,
                        deviceId
                    })
                }
                else if (!match) {
                    res.json({
                        status: false,
                        message: "Invalid PIN",
                        // deviceId
                    })
                }
            }
            else {
                res.json({
                    status: false,
                    message: "Invalid Credentials",
                    deviceId
                })
            }
        })

        // log out from all devices API
        app.get('/logout-all-devices/:email', async (req, res) => {
            const email = req.params.email;
            const updatedUser = await userCollection.updateOne({ email: email }, { $set: { deviceId: '' } })
            res.json({
                status: true,
                message: "Successfully Logged Out from all devices",
                data: updatedUser
            })
        })

        // delete user form the db API 
        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const user = await userCollection.findOne(query);
            const deletedAllCartItems = await cartCollection.deleteMany({ orderer: user?.email })
            const result = await userCollection.deleteOne(query);

            res.json({
                status: true,
                data: result,
                deleted: deletedAllCartItems
            })
        })

        // get all users API 
        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.json({
                status: true,
                data: result
            })
        })

        // get one user API 
        app.get('/user/:email', async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const result = await userCollection.findOne(query)
            res.json({
                status: true,
                data: result
            })
        })

        // update one user info API 
        app.patch('/user', async (req, res) => {
            const body = req.body
            const id = body?.id
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    name: body?.name,
                }
            }
            console.log(updatedDoc);
            const result = await userCollection.updateOne(query, updatedDoc);
            res.json({
                status: true,
                data: result
            })
        })

        // money operation related APIS 
        // send money API 
        app.post('/send-money', verifyToken, async (req, res) => {
            try {
                let { amount, receiverPhoneNumber, senderEmail, pin } = req.body;
                amount = Number(amount);

                if (isNaN(amount) || amount < 50) {
                    return res.json({ status: false, message: "Amount must be a number greater than 50" });
                }

                const senderUser = await userCollection.findOne({ email: senderEmail });
                if (!senderUser) return res.json({ status: false, message: "Sender not found" });

                const receiverUser = await userCollection.findOne({ phoneNumber: receiverPhoneNumber });
                if (!receiverUser) return res.json({ status: false, message: "Receiver not found" });

                if (senderUser.phoneNumber === receiverPhoneNumber) {
                    return res.json({ status: false, message: "You can't send money to yourself" });
                }

                console.log("Received PIN:", pin);
                console.log("Stored Hashed PIN:", senderUser.pin);

                const pinIsMatch = await bcrypt.compare(pin, senderUser.pin);
                if (!pinIsMatch) {
                    return res.json({ status: false, message: "PIN Number Doesn't Match" });
                }

                let sendMoneyFee = amount >= 100 ? 5 : 0;
                let totalAmount = amount + sendMoneyFee;

                if (totalAmount > senderUser.balance) {
                    return res.json({ status: false, message: "You don't have enough money!" });
                }

                await userCollection.updateOne({ email: senderEmail }, { $inc: { balance: -totalAmount } });
                await userCollection.updateOne({ phoneNumber: receiverPhoneNumber }, { $inc: { balance: amount } });
                await userCollection.updateOne({ role: "admin" }, { $inc: { balance: sendMoneyFee } });

                res.json({ status: true, message: "Money sent successfully!", sendMoneyFee });
            } catch (error) {
                res.status(500).json({ status: false, message: "Server error", error: error.message });
            }
        });

        // cash out API 
        app.post('/cash-out', verifyToken, async (req, res) => {
            const { amount, pin, senderEmail, ...data } = req.body
            const senderUser = await userCollection.findOne({ email: senderEmail })
            const agentUser = await userCollection.findOne({ email: data.agentEmail })


            if (isNaN(amount) || amount < 50) {
                return res.json({ status: false, message: "Amount must be a number greater than 50" });
            }


            // Calculate profits
            const adminProfit = (amount * 0.005);
            const agentProfit = (amount * 0.01);

            if (!senderUser) return res.json({ status: false, message: "Sender not found" });
            if (!agentUser) return res.json({ status: false, message: "Agent not found" });

            const pinIsMatch = await bcrypt.compare(pin, senderUser?.pin);
            if (!pinIsMatch) {
                return res.json({ status: false, message: "PIN Number Doesn't Match" });
            }

            if (amount > senderUser.balance) {
                return res.json({ status: false, message: "You don't have enough money!" });
            }

            const insertedDoc = {
                ...data, senderEmail, amount, adminProfit, agentProfit
            }

            const result = await transactionsCollection.insertOne(insertedDoc)

            res.json({
                status: true,
                result,
                message: "Cash Out Request Send"
            })
        })


        // agent related APIS 
        // verified agents API 
        app.get('/verified-agents', verifyToken, async (req, res) => {
            const result = await userCollection.find({ role: "agent", verified: true }).toArray()
            res.json({
                status: true,
                data: result
            })
        })

        // get the pending cash out in specific agent API 
        app.get('/cash-out/request/:email', verifyToken, verifyAgent, async (req, res) => {
            const email = req.params.email
            const result = await transactionsCollection.find({ status: "pending", type: "cash out", agentEmail: email }).toArray()

            res.json({
                status: true,
                data: result
            })
        })

        // cash out request accept API 
        app.post('/cash-out/accept', verifyToken, verifyAgent, async (req, res) => {
            try {
                const { senderEmail, agentProfit, adminProfit, amount, agentEmail, _id } = req.body;

                // Validate request data
                if (!senderEmail || !agentEmail || !_id || !amount || !agentProfit || !adminProfit) {
                    return res.json({ status: false, message: "Missing required fields" });
                }

                // Update agent's balance: Add profit first, then deduct total amount
                await userCollection.updateOne(
                    { email: agentEmail, role: "agent", verified: true },
                    { $inc: { balance: agentProfit - amount } }
                );

                // Update admin's balance
                await userCollection.updateOne(
                    { role: "admin" },
                    { $inc: { balance: adminProfit } }
                );

                // Deduct amount from sender (user)
                await userCollection.updateOne(
                    { email: senderEmail },
                    { $inc: { balance: -amount } }
                );

                // Update transaction status to 'accepted'
                await transactionsCollection.updateOne(
                    { _id: new ObjectId(_id) },
                    { $set: { status: 'accepted' } }
                );

                // Send success response
                res.json({
                    status: true,
                    message: "Cash Out Request Accepted"
                });

            } catch (error) {
                console.error("Error processing cash-out request:", error);
                res.status(500).json({ status: false, message: "Internal Server Error" });
            }
        });

        // cash out request cancel API 
        app.post('/cash-out/canceled', verifyToken, verifyAgent, async (req, res) => {
            const { _id } = req.body

            // change status pending to cancel 
            await transactionsCollection.updateOne({ _id: new ObjectId(_id) }, { $set: { status: "canceled" } })

            res.json({
                status: true,
                message: "Cash Out Request Canceled!"
            })
        })

        // get agent transactions API 
        app.get('/transactions/agent/:email', verifyToken, verifyAgent, async (req, res) => {
            const email = req.params.email
            const result = await transactionsCollection.find({ agentEmail: email }).sort({ timestamp: -1 }).toArray()
            res.json({
                status: true,
                data: result
            })
        })



        // transactions related APIS 
        // insert transaction API 
        app.post('/transactions', verifyToken, async (req, res) => {
            try {
                const transaction = req.body;
                const result = await transactionsCollection.insertOne(transaction);
                res.json({ status: true, transaction });
            } catch (error) {
                res.status(500).json({ status: false, message: "Server error", error: error.message });
            }
        });



        // activity related APIs 
        // insert activity API 
        app.post('/activity', verifyToken, async (req, res) => {
            const activity = req.body;
            const result = await activityCollection.insertOne(activity);
            res.json({
                status: true,
                data: result
            })
        })

        // get all the activities API
        app.get('/activity', verifyToken, async (req, res) => {
            const result = await activityCollection.find().toArray();
            res.json({
                status: true,
                data: result
            })
        })

        // user role check API 
        app.get('/users/role/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (req.user.email !== email) return res.status(403).json({ message: "unauthorized" });
            const query = { email: email };
            const user = await userCollection.findOne(query);
            let role = null;
            if (user?.role === "admin") {
                role = user?.role;
            }
            if (user?.role === "agent") {
                role = user?.role
            }
            if (user?.role === "user") {
                role = user?.role
            }
            if (email === undefined) {
                role = false
            }
            res.json({
                status: true,
                data: role
            })
        })

    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.json({
        message: "Yoo Server is running well!!"
    })
})

module.exports = app;