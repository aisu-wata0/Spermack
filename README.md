<h1 align="center">Spermack</h1>

<p align="center">Script for connecting Claude to Tavern</p>
<p align="center">(Credits at the bottom of this page. I DEMAND you acknowledge everyone who made this work.)</p>

---
<br>
<br>
<br>

# Setting Up Slack

You need to register on Slack (https://slack.com) and make a workgroup. If you already have a Slack account, make a new one for this.

Then you need to add Claude (https://slack.com/apps/A04KGS7N9A8-claude) to your workgroup.

# Script Setup

Download the zip from this page.

To do that, scroll to the top of this page, find the green button labeled <>Code. Click it, and then hit Download ZIP.

Extract the dowloaded .zip and enter the -main folder.

Open the config file in a text editor of your choice. There are 4 values there, I'll explain them in order:



## TOKEN:
In the workspace you created, press F12, go to the network tab(very top of inspect element tabs), once in that tab send a message in any channel, and look for the request starting with chat.postMessage, click it.
Click the request(FF)/payload(Chromium) option at the top of the new section, we are looking for a token there starting with xoxc-. Copy it completely(it is the rest of the single line starting with xoxc-) and paste it into TOKEN
![image](https://user-images.githubusercontent.com/129290831/234063889-99ecb1d5-d3f8-43a3-8fca-1e7a3e481134.png)


## COOKIE:
Copy the cookies **ENCODED** in the url.
Go to your workspace and press F12. Go to the storage(FF)/application(Chromium) option at the top of the inspect element tab, look for cookies called d, with a value starting with xoxd-.
Copy its value completely and paste it into the COOKIE
![image](https://user-images.githubusercontent.com/129290831/234064337-4e5d9c7c-2da9-49ad-85e5-e22847ce471c.png)

## TEAM_ID:
Go to the main page of your workspace on Slack. In the upper left corner, click on the name of your workspace with a down arrow next to it. There will be a link, like coomer-workspace.slack.com. Copy what is up to the first dot (coomer-workspace) and paste it into TEAM_ID

## CLAUDE:
Go to the your DMs with Claude, open the account's info at the top of your chat window and grab the channel ID from the bottom of the new window. We insert it into CLAUDE

![image](https://user-images.githubusercontent.com/129290831/234062310-b2ea0dd2-20fa-41e3-bfaa-d5cfc8dfbe28.png)

## CLAUDE_MEMBER_ID:
Leave that empty.


# How to connect to Tavern?



First, if you haven't used Claude on Slack yet, sent it a test message and press Accept when it gives you the TOS.

Make sure that in the API(Plug) tab of SillyTavern you have OpenAI selected. Put random text in the API Key field.

Run start.bat. In the console, you'll see a local IP address. Copy it.

In SillyTavern, open OpenAI settings(sliders tab). Select GPT-4 as the OpenAI Mode. In the Reverse Proxy box under that, paste in the IP in your clipboard. In the API tab, hit connect. Congratulations!


<h1 align="center">Troubleshooting</h1>


<p align="center">{ ok: false, error: 'invalid_auth' }</p>

Something with your config.js is incorrect. The most likely cause of this is you not including the "xoxc-" or "xoxd-" parts in your token/cookie.


<p align="center">{ ok: false, error: 'invalid_blocks_format' }</p>

Claude cannot handle any backslashes(\\) anywhere. If one shows up on a chararcter card or a in a conversation, this error will occur. Remove all backslashes to fix this.



# Credits



Original code by Barbariskaa (https://github.com/Barbariskaa/Spermack)

Streaming and many other fixes by Bruno FS (https://github.com/bfs15)

Translation/Readme by AmmoniaM <3
