import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AzureChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const chatModel = new AzureChatOpenAI({
	azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
	azureOpenAIApiInstanceName: process.env.INSTANCE_NAME, // In target url: https://<INSTANCE_NAME>.services...
	azureOpenAIApiDeploymentName: process.env.AZUREAI_MODEL, // i.e "gpt-4o"
	azureOpenAIApiVersion: "2024-08-01-preview", // In target url: ...<VERSION>
	temperature: 1,
	maxTokens: 4096,
});

const sessionMemories = {};

function getSessionMemory(sessionId) {
	if (!sessionMemories[sessionId]) {
		const history = new ChatMessageHistory();
		sessionMemories[sessionId] = new BufferMemory({
			chatHistory: history,
			returnMessages: true,
			memoryKey: "chat_history",
		});
	}
	return sessionMemories[sessionId];
}

app.post("/chat", async (req, res) => {
	// Support both { message } and { messages: [...] }
	let userMessage = req.body.message;
	console.log("Raw request body:", req.body);
	if (!userMessage && Array.isArray(req.body.messages)) {
		// Find the last user message in the array
		const lastUserMsg = [...req.body.messages]
			.reverse()
			.find((m) => m.role === "user" && m.content);
		userMessage = lastUserMsg ? lastUserMsg.content : undefined;
	}
	console.log("User message:", userMessage);
	const sessionId = req.body.sessionId || "default";

	const memory = getSessionMemory(sessionId);
	const memoryVars = await memory.loadMemoryVariables({});

	// Prepare system prompt for healthy living advisor only
	const systemMessage = {
		role: "system",
		content:
			"You are a certified healthy living advisor. Provide friendly, concise, and evidence-based advice on fitness, nutrition, mental wellness, sleep, and general lifestyle improvements. Tailor responses to the user's needs and avoid giving medical diagnoses.",
	};

	try {
		// Build final messages array
		const messages = [
			systemMessage,
			...(memoryVars.chat_history || []),
			{ role: "user", content: userMessage },
		];

		console.log("Final messages sent to model:", messages);
		const response = await chatModel.invoke(messages);
		

		await memory.saveContext(
			{ input: userMessage },
			{ output: response.content }
		);

		// Respond in BotResponse format for frontend compatibility
		res.json({
			choices: [
				{
					message: {
						role: "assistant",
						content: response.content,
						context: {
							thoughts: undefined, // You can add thoughts if available
							data_points: [],
						},
					},
				},
			],
		});
	} catch (err) {
		console.error("Model error:", err);
		res.status(500).json({
			error: "Model call failed",
			message: err.message,
			reply: "Sorry, I encountered an error. Please try again.",
		});
	}
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
	console.log(`AI API server running on port ${PORT}`);
});
